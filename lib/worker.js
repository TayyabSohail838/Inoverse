// The background worker: claims due jobs and runs one step of each. Server only.
// Called by /api/jobs/run (started by kick() and every minute by Supabase).
//
// - Several workers can run at once: claim_jobs() hands each job to only one of them.
// - It stops claiming after ~25 s, so a step that starts still finishes inside the 60 s
//   limit; anything left is handed to a fresh worker (kick).
// - A failed step is retried after 30 s, 60 s, … up to the job's max_attempts, then the
//   job is marked failed with the reason. A worker that dies mid-step leaves a lease
//   that runs out after 90 s, and the step is picked up again.
import { serviceDb } from "@/lib/db";
import { runAsOrg } from "@/lib/tenant";
import { kick } from "@/lib/jobs";
import { KINDS, schedule } from "@/lib/jobKinds";

const BUDGET_MS = 25_000;
const LEASE_SECS = 90;

async function save(id, patch) {
  await serviceDb().from("jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

async function runStep(job) {
  const kind = KINDS[job.kind];
  if (!kind) return save(job.id, { status: "failed", error: `Unknown job kind: ${job.kind}`, locked_until: null });
  try {
    const step = () => kind.step(job.input || {}, job.state || {});
    const out = job.org_id
      ? await runAsOrg({ orgId: job.org_id, userId: job.user_id, client: serviceDb(), system: true, feature: kind.feature }, step)
      : await step();
    if (out.done) {
      await save(job.id, { status: "done", result: out.result ?? null, state: {}, error: null, attempts: 0, locked_until: null });
    } else {
      // next step right away, and a fresh count of tries for it
      await save(job.id, { status: "queued", state: out.state, error: null, attempts: 0, run_at: new Date().toISOString(), locked_until: null });
    }
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 500);
    if (job.attempts >= job.max_attempts) {
      console.error(`Job ${job.kind} ${job.id} failed for good:`, msg);
      await save(job.id, { status: "failed", error: msg, locked_until: null });
    } else {
      const wait = 30_000 * 2 ** (job.attempts - 1);
      console.warn(`Job ${job.kind} ${job.id} step failed (try ${job.attempts}); again in ${wait / 1000}s:`, msg);
      await save(job.id, { status: "queued", error: msg, run_at: new Date(Date.now() + wait).toISOString(), locked_until: null });
    }
  }
}

// tick: also add the jobs that are due on the schedule (briefs, Gmail checks).
export async function work(origin, { tick = false } = {}) {
  const started = Date.now();
  const ran = { steps: 0, scheduled: null };
  if (tick) ran.scheduled = await schedule().catch((err) => console.warn("Job schedule:", err.message));

  while (Date.now() - started < BUDGET_MS) {
    const { data: jobs, error } = await serviceDb().rpc("claim_jobs", { p_limit: 4, p_lease_secs: LEASE_SECS });
    if (error) {
      console.warn("Jobs:", error.message);
      break;
    }
    if (!jobs?.length) break;
    await Promise.allSettled(jobs.map(runStep));
    ran.steps += jobs.length;
  }

  // more work due right now (e.g. the next step of a gap check)? hand it to a fresh worker
  const { count } = await serviceDb()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lte("run_at", new Date().toISOString());
  if (count) await kick(origin);
  return ran;
}
