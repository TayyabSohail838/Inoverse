// GET /api/usage → this company's AI allowance and use
// { allowance: { companyToday?: { used, limit, resetsAt }, youThisHour?: {…} },
//   month: [{ feature, calls, tokens }], costs: { chat: 1, … } }
import { route } from "@/lib/http";
import { allowanceNow, monthUsage, COST } from "@/lib/usage";
import { isDemo } from "@/lib/demo";

export const GET = route(async () => {
  if (isDemo()) return Response.json({ allowance: {}, month: [], costs: COST, demo: true });
  const [allowance, month] = await Promise.all([allowanceNow().catch(() => ({})), monthUsage().catch(() => [])]);
  return Response.json({ allowance, month, costs: COST });
});
