// lib/worker.js against an in-memory job table that behaves like claim_jobs().
import { test } from "node:test";
import { ok } from "./helpers.mjs";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.APP_URL = "http://127.0.0.1:9"; // kick() goes nowhere in the test
delete process.env.JOBS_SECRET;
const { setDbForTests } = await import("@/lib/db");
const { tenantOrNull } = await import("@/lib/tenant");
const { KINDS } = await import("@/lib/jobKinds");
const { work } = await import("@/lib/worker");
const { secretOk, jobsSecret } = await import("@/lib/jobs");

const jobs = new Map();
let n = 0;
const add = (kind, extra = {}) => {
  const id = `job-${++n}`;
  jobs.set(id, { id, kind, status: "queued", input: {}, state: {}, attempts: 0, max_attempts: 3, run_at: new Date().toISOString(), org_id: null, user_id: null, ...extra });
  return id;
};
setDbForTests({
  rpc(name, { p_limit }) {
    const due = [...jobs.values()].filter((j) => j.status === "queued" && Date.parse(j.run_at) <= Date.now()).slice(0, p_limit);
    for (const j of due) {
      j.status = "running";
      j.attempts += 1;
    }
    return Promise.resolve({ data: due.map((j) => ({ ...j })), error: null });
  },
  from() {
    let patch = null;
    let id = null;
    let counting = false;
    const chain = {
      update(p) {
        patch = p;
        return chain;
      },
      select(_, opts) {
        counting = Boolean(opts?.count);
        return chain;
      },
      eq(k, v) {
        if (k === "id") id = v;
        return chain;
      },
      lte: () => chain,
      then(res) {
        if (patch && id) Object.assign(jobs.get(id), patch);
        if (counting) return res({ count: [...jobs.values()].filter((j) => j.status === "queued" && Date.parse(j.run_at) <= Date.now()).length, error: null });
        return res({ data: null, error: null });
      },
    };
    return chain;
  },
});

const seen = [];
KINDS["t-steps"] = {
  feature: "test",
  async step(input, state) {
    seen.push({ org: tenantOrNull()?.orgId, feature: tenantOrNull()?.feature, stage: state.stage || "start" });
    if (!state.stage) return { done: false, state: { stage: "two" } };
    if (state.stage === "two") return { done: false, state: { stage: "three" } };
    return { done: true, result: { answer: 42 } };
  },
};
let flakyCalls = 0;
KINDS["t-flaky"] = {
  async step() {
    if (++flakyCalls < 2) throw new Error("Google busy");
    return { done: true, result: "ok" };
  },
};
KINDS["t-broken"] = {
  async step() {
    throw new Error("always broken");
  },
};

test("a job in several steps", async () => {
  const a = add("t-steps", { org_id: "org-A", user_id: "u1" });
  await work("", {});
  const ja = jobs.get(a);
  ok(ja.status === "done" && ja.result.answer === 42, "runs every step and finishes", JSON.stringify(ja));
  ok(seen.length === 3 && seen.every((s) => s.org === "org-A" && s.feature === "test"), "each step runs inside its company", JSON.stringify(seen));
  ok(ja.attempts === 0 && ja.error === null, "a successful step resets the try count");
});

test("retries", async () => {
  const f = add("t-flaky");
  await work("", {});
  let jf = jobs.get(f);
  ok(jf.status === "queued" && /Google busy/.test(jf.error) && Date.parse(jf.run_at) - Date.now() > 20_000, "a failed step waits ~30 s and tries again", JSON.stringify(jf));
  jf.run_at = new Date().toISOString(); // time passes
  await work("", {});
  jf = jobs.get(f);
  ok(jf.status === "done" && jf.result === "ok", "the retry succeeds");

  const b = add("t-broken");
  for (let i = 0; i < 3; i++) {
    await work("", {});
    jobs.get(b).run_at = new Date().toISOString();
  }
  const jb = jobs.get(b);
  ok(jb.status === "failed" && /always broken/.test(jb.error) && jb.attempts === 3, "after 3 tries it's marked failed, with the reason", JSON.stringify(jb));

  const u = add("no-such-kind");
  await work("", {});
  ok(jobs.get(u).status === "failed", "an unknown job kind fails instead of looping");
});

test("only the right secret starts the worker", () => {
  ok(secretOk(jobsSecret()) && !secretOk("wrong") && !secretOk(""), "right secret accepted, others refused");
});
