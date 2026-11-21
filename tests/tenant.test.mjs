// Server-side company separation, with a fake Supabase client that records every query.
import { test } from "node:test";
import { ok, throws } from "./helpers.mjs";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret";
process.env.DEMO_MODE = "off";
const { runAsOrg, bindTenant } = await import("@/lib/tenant");
const { setDbForTests } = await import("@/lib/db");
const store = await import("@/lib/store");
const tasks = await import("@/lib/tasks");
const { sign, unsign } = await import("@/lib/signed");

// every from() chain is logged as { client, table, op, filters, payload }
function fake(name, log) {
  return {
    from(table) {
      const q = { client: name, table, op: "select", filters: {}, payload: null };
      log.push(q);
      const chain = new Proxy(
        {},
        {
          get(_, k) {
            if (k === "then") return (res) => res({ data: q.op === "select" ? [] : { id: "x" }, error: null });
            return (...args) => {
              if (k === "eq") q.filters[args[0]] = args[1];
              if (["insert", "update", "upsert", "delete"].includes(k)) {
                q.op = k;
                q.payload = args[0];
              }
              return chain;
            };
          },
        }
      );
      return chain;
    },
  };
}

const log = [];
setDbForTests(fake("service", log));
const ctx = (org) => ({ orgId: org, client: fake(`user-${org}`, log), system: false });

test("no company selected", async () => {
  log.length = 0;
  ok((await store.listEvidence()).length === 0 && log.length === 0, "reads return nothing and touch no data");
  ok(await throws(() => store.addEvidence({ content: "x" })), "writes refuse");
});

test("inside a company", async () => {
  log.length = 0;
  await runAsOrg(ctx("org-A"), () => store.listEvidence());
  ok(log[0]?.client === "user-org-A" && log[0].filters.org_id === "org-A", "reads use the user's client and filter by company", JSON.stringify(log[0]));
  log.length = 0;
  await runAsOrg(ctx("org-A"), () => tasks.addTask({ title: "t" }));
  ok(log[0]?.payload?.org_id === "org-A" && !("company" in log[0].payload), "new rows are stamped with the company", JSON.stringify(log[0]?.payload));
  log.length = 0;
  await runAsOrg(ctx("org-A"), () => tasks.getIntegration("google"));
  ok(log[0]?.client === "service" && log[0].filters.org_id === "org-A", "Google sign-ins are read with the server key, still filtered by company");
});

test("two companies at the same time never mix", async () => {
  log.length = 0;
  const slow = (org, ms) =>
    runAsOrg(ctx(org), async () => {
      await new Promise((r) => setTimeout(r, ms));
      await store.listEvidence();
      await new Promise((r) => setTimeout(r, ms));
      await store.listCommitments();
    });
  await Promise.all([slow("org-A", 30), slow("org-B", 10), slow("org-C", 20)]);
  const mixed = log.filter((q) => q.client !== `user-${q.filters.org_id}`);
  ok(log.length === 6 && mixed.length === 0, "interleaved requests never borrow another company's context", JSON.stringify(mixed));
});

test("work after the reply keeps its company", async () => {
  log.length = 0;
  let later;
  await runAsOrg(ctx("org-A"), async () => {
    later = bindTenant();
  });
  await later(store.saveMessages, [{ role: "user", text: "hi" }]);
  ok(log[0]?.payload?.[0]?.org_id === "org-A", "a deferred save keeps its company");
});

test("the public demo can't save", async () => {
  process.env.DEMO_MODE = "on";
  try {
    const e = await throws(() => runAsOrg(ctx("org-A"), () => store.addEvidence({ content: "x" })));
    ok(e?.constructor?.name === "DemoError", "writes are refused", e?.message);
    log.length = 0;
    await runAsOrg(ctx("org-A"), () => store.saveGapCheck("idea", { gapCheck: { test: {} } }));
    ok(log.length === 0, "side saves (gap checks) are skipped");
  } finally {
    process.env.DEMO_MODE = "off";
  }
});

test("the signed Google connect state", () => {
  const s = sign({ org: "org-A", nonce: "n" }, 60);
  ok(unsign(s)?.org === "org-A", "a valid state is accepted");
  const sig = s.split(".")[1];
  const forged = Buffer.from(JSON.stringify({ org: "org-B", nonce: "n", exp: Date.now() + 6e4 })).toString("base64url") + "." + sig;
  ok(unsign(forged) === null, "changing the company breaks the signature");
  ok(unsign(sign({ org: "org-A" }, -1)) === null, "an expired state is refused");
});
