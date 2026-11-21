// AI allowance and tracking in the server code: context cache, charging, fail-open, model status.
import { test } from "node:test";
import { ok } from "./helpers.mjs";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.DEMO_MODE = "off";
const { runAsOrg } = await import("@/lib/tenant");
const { setDbForTests } = await import("@/lib/db");
const { buildContext, forgetContext } = await import("@/lib/context");
const { spend, LimitError, recordUsage, rest, restingUntil } = await import("@/lib/usage");

// counts queries, answers rpc() from rpcAnswer, records inserts
let queries = 0;
let rpcAnswer = { data: { allowed: true }, error: null };
const inserts = [];
const rpcs = [];
const fake = {
  from(table) {
    queries++;
    const chain = new Proxy(
      {},
      {
        get(_, k) {
          if (k === "then") return (res) => res({ data: [], error: null });
          return (...a) => {
            if (k === "insert" || k === "upsert") inserts.push({ table, row: a[0] });
            return chain;
          };
        },
      }
    );
    return chain;
  },
  rpc(name, args) {
    rpcs.push({ name, args });
    return Promise.resolve(rpcAnswer);
  },
};
setDbForTests(fake);
const ctx = (org, user = "u1") => ({ orgId: org, userId: user, client: fake, system: false });

test("company context is cached per company", async () => {
  queries = 0;
  await runAsOrg(ctx("A"), () => buildContext());
  const first = queries;
  await runAsOrg(ctx("A"), () => buildContext());
  ok(first > 0 && queries === first, "the second answer reuses it", `${first} then ${queries}`);
  await runAsOrg(ctx("B"), () => buildContext());
  ok(queries > first, "another company builds its own");
  const before = queries;
  forgetContext("A");
  await runAsOrg(ctx("A"), () => buildContext());
  ok(queries > before, "after a change it's rebuilt");
});

test("charging the allowance", async () => {
  rpcs.length = 0;
  await runAsOrg(ctx("A"), () => spend("gap-check"));
  const a = rpcs[0]?.args;
  ok(a?.p_cost === 5 && a.p_keys.includes("o:A:d") && a.p_keys.includes("u:u1:h"), "a gap check charges 5 units to the user's hour and the company's day", JSON.stringify(a));

  rpcAnswer = { data: { allowed: false, key: "o:A:d", used: 400, limit: 400, reset_at: new Date().toISOString() }, error: null };
  let err = null;
  try {
    await runAsOrg(ctx("A"), () => spend("chat"));
  } catch (e) {
    err = e;
  }
  ok(err instanceof LimitError && /company has used today/.test(err.message), "a full allowance gives a clear message", err?.message);

  rpcAnswer = { data: null, error: { message: "function ai_spend does not exist" } };
  err = null;
  try {
    await runAsOrg(ctx("A"), () => spend("chat"));
  } catch (e) {
    err = e;
  }
  ok(err === null, "without usage.sql, Inovo still answers");
  rpcAnswer = { data: { allowed: true }, error: null };
});

test("each AI call is tracked", async () => {
  inserts.length = 0;
  await runAsOrg(ctx("A", "u7"), async () => {
    await spend("weekly");
    await recordUsage({ model: "gemma-x", usage: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 10 }, ms: 812 });
  });
  const row = inserts.find((i) => i.table === "ai_usage")?.row;
  ok(row?.org_id === "A" && row.user_id === "u7" && row.feature === "weekly" && row.input_tokens === 120 && row.output_tokens === 40, "stored with company, user, feature and tokens", JSON.stringify(row));
});

test("a busy model is shared with every server copy", async () => {
  inserts.length = 0;
  await rest("gemma-test", 60_000, "busy");
  ok(inserts.some((i) => i.table === "ai_model_status" && i.row.model === "gemma-test"), "saved for everyone");
  ok((await restingUntil("gemma-test")) > Date.now(), "and skipped until it's ready");
});
