// GET  /api/orgs/access → { members: [{ user_id, role, email }], invites: [{ id, email, role }], me: { id, role } }
// POST /api/orgs/access { email, role? } → { invite }: invite someone (owners only).
//      They join automatically the next time they sign in with that (confirmed) email.
import { route, readJson, requireOwner } from "@/lib/http";
import { listAccess, invite } from "@/lib/orgs";
import { tenant } from "@/lib/tenant";
import { demoReadOnly } from "@/lib/demo";
import { hit } from "@/lib/ratelimit";

export const GET = route(async () => {
  const t = tenant();
  if (t.demo) return Response.json({ members: [], invites: [], me: null, demo: true });
  return Response.json({ ...(await listAccess()), me: { id: t.userId, role: t.role } });
});

export const POST = route(async (req) => {
  demoReadOnly();
  requireOwner();
  await hit("invite", req);
  return Response.json({ invite: await invite(await readJson(req)) }, { status: 201 });
});
