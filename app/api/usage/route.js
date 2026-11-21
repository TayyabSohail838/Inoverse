// GET /api/usage → this company's AI allowance and use
// { allowance: { companyToday?: { used, limit, resetsAt }, youThisHour?: {…} },
//   month: [{ feature, calls, tokens }], costs: { chat: 1, … }, models: { chat: {…}, live: {…} } }
import { route } from "@/lib/http";
import { allowanceNow, monthUsage, COST } from "@/lib/usage";
import { isDemo } from "@/lib/demo";
import { modelStatus } from "@/lib/gemma";

export const GET = route(async () => {
  if (isDemo()) return Response.json({ allowance: {}, month: [], costs: COST, demo: true });
  const [allowance, month, models] = await Promise.all([allowanceNow().catch(() => ({})), monthUsage().catch(() => []), modelStatus().catch(() => null)]);
  return Response.json({ allowance, month, costs: COST, models });
});
