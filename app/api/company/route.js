// GET /api/company → { profile, team, products }
// PUT /api/company { name, about }
import { getCompany, saveProfile } from "@/lib/store";
import { renameOrg } from "@/lib/orgs";
import { route, readJson } from "@/lib/http";

export const GET = route(async () => Response.json((await getCompany()) || { profile: null, team: [], products: [] }));

export const PUT = route(async (req) => {
  const profile = await saveProfile(await readJson(req));
  // the company switcher shows this name too (owners only; skipped quietly for members)
  await renameOrg(profile.name).catch(() => {});
  return Response.json({ profile });
});
