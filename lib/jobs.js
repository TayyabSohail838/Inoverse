// Background jobs: add work to the queue and start the worker. Server only.
//
// Slow or scheduled work (gap checks, morning briefs, WhatsApp replies) is
// written to the `jobs` table (supabase/jobs.sql) instead of being done inside the user's
// request. The worker (/api/jobs/run, lib/worker.js) runs it one short step at a time,
// with retries. It's started right away by kick(), and every minute by Supabase
// (schedule-jobs.sql) as a safety net.
//
// Without jobs.sql nothing breaks: jobsReady() is false and callers do the work inline.
import { createHash, timingSafeEqual } from "node:crypto";
import { dbEnabled, serviceDb } from "@/lib/db";
import { tenantOrNull } from "@/lib/tenant";

// Proves a call to /api/jobs/run comes from this app or from Supabase's schedule.
// JOBS_SECRET, or by default a value derived from the service key (same everywhere it's set).
export const jobsSecret = () =>
  process.env.JOBS_SECRET || createHash("sha256").update(`inoverse-jobs:${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`).digest("hex");

export function secretOk(value) {
  if (!value) return false;
  const a = Buffer.from(String(value));
  const b = Buffer.from(jobsSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

// Is the jobs table there? Checked at most once a minute.
let ready = null;
let checkedAt = 0;
export async function jobsReady() {
  if (!dbEnabled()) return false;
  if (ready !== null && Date.now() - checkedAt < 60_000) return ready;
  const { error } = await serviceDb().from("jobs").select("id").limit(1);
  ready = !error;
  checkedAt = Date.now();
  return ready;
}

// Add a job. dedupe: a key that makes sure the same job is only added once
// (e.g. one brief per company per day). Returns the job id, or null if it already existed.
export async function enqueue(kind, input = {}, { org, user, dedupe, runAt } = {}) {
  const t = tenantOrNull();
  const row = {
    kind,
    input,
    org_id: org !== undefined ? org : t?.orgId || null,
    user_id: user !== undefined ? user : t?.userId || null,
    dedupe_key: dedupe || null,
    run_at: (runAt || new Date()).toISOString(),
  };
  const q = serviceDb().from("jobs");
  const { data, error } = dedupe
    ? await q.upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id")
    : await q.insert(row).select("id");
  if (error) throw new Error(`Couldn't queue ${kind}: ${error.message}`);
  return data?.[0]?.id || null;
}

// Start the worker now (it answers at once and works in the background), instead of
// waiting for the next minute. Never throws.
export async function kick(origin) {
  const base = (process.env.APP_URL || origin || "").replace(/\/$/, "");
  if (!base) return;
  try {
    await fetch(`${base}/api/jobs/run`, {
      method: "POST",
      headers: { "x-jobs-secret": jobsSecret() },
      signal: AbortSignal.timeout(8000),
    });
  } catch {}
}

// A job for the current company (for the app's progress view). Hides the step data.
export async function jobForCompany(id) {
  const t = tenantOrNull();
  if (!t?.orgId) return null;
  const { data } = await serviceDb()
    .from("jobs")
    .select("id, kind, status, result, error, stage:state->>stage, created_at")
    .eq("id", id)
    .eq("org_id", t.orgId)
    .maybeSingle();
  return data || null;
}
