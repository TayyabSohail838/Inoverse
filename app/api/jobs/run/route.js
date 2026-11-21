// POST|GET /api/jobs/run → starts the background worker (lib/worker.js).
// Called by kick() right after a job is added, every minute by Supabase (schedule-jobs.sql,
// with ?tick=1 so it also adds the scheduled morning briefs), and once a day by
// Vercel Cron as a fallback (vercel.json). Answers at once; the work runs after the reply.
// Needs the jobs secret (x-jobs-secret), or Vercel Cron's "Authorization: Bearer CRON_SECRET".
import { after } from "next/server";
import { jobsReady, secretOk } from "@/lib/jobs";
import { work } from "@/lib/worker";

export const maxDuration = 60;

function allowed(req) {
  if (secretOk(req.headers.get("x-jobs-secret"))) return true;
  const cron = process.env.CRON_SECRET;
  return Boolean(cron) && req.headers.get("authorization") === `Bearer ${cron}`;
}

async function handle(req) {
  if (!allowed(req)) return new Response("Unauthorized", { status: 401 });
  if (!(await jobsReady())) return Response.json({ error: "Run supabase/jobs.sql first." }, { status: 503 });
  const url = new URL(req.url);
  // Vercel Cron calls with GET: treat it as a tick too
  const tick = url.searchParams.has("tick") || req.method === "GET";
  after(() => work(url.origin, { tick }).catch((err) => console.error("Worker:", err.message)));
  return Response.json({ accepted: true, tick }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
