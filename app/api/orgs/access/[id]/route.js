// DELETE /api/orgs/access/<id>?kind=invite → cancel an invite (owners only)
// DELETE /api/orgs/access/<userId>         → remove a member (owners), or leave (yourself)
import { route, idFrom, requireOwner } from "@/lib/http";
import { cancelInvite, removeMember } from "@/lib/orgs";
import { forgetToken } from "@/lib/auth";
import { tenant } from "@/lib/tenant";
import { demoReadOnly } from "@/lib/demo";

export const DELETE = route(async (req, ctx) => {
  demoReadOnly();
  const id = await idFrom(ctx);
  if (new URL(req.url).searchParams.get("kind") === "invite") {
    requireOwner();
    await cancelInvite(id);
  } else {
    await removeMember(id);
    if (id === tenant().userId) forgetToken(tenant().token); // left the company
  }
  return Response.json({ ok: true });
});
