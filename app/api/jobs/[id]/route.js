// GET /api/jobs/<id> → { status: queued|running|done|failed, stage, result?, error? }
// The app polls this to show a gap check's progress and its verdict. Only the company's own jobs.
import { route, idFrom } from "@/lib/http";
import { jobForCompany } from "@/lib/jobs";

export const GET = route(async (req, ctx) => {
  const job = await jobForCompany(await idFrom(ctx));
  if (!job) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({
    status: job.status,
    stage: job.stage || null,
    result: job.status === "done" ? job.result : null,
    error: job.status === "failed" ? "The check didn't finish. Try asking again in a minute." : null,
  });
});
