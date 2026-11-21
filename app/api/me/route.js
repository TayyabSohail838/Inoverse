// GET /api/me → who is signed in and which companies they belong to.
// { signedIn, user: { id, email }, orgs: [{ id, name, role }], org: { id, name, role } | null, profileSet }
// Signed in but no company yet → org: null (the app then asks to create one).
// Joins any company that invited this email on the way (see accept_invites in multitenant.sql).
import { route } from "@/lib/http";
import { tenantOrNull } from "@/lib/tenant";
import { isDemo } from "@/lib/demo";
import { getCompany } from "@/lib/store";

export const GET = route(
  async () => {
    const t = tenantOrNull();
    if (!t || isDemo()) {
      // single-laptop mode or the public demo: no accounts
      return Response.json({ signedIn: false, demo: isDemo(), user: null, orgs: [], org: t?.orgId ? { id: t.orgId, name: t.orgName, role: "member" } : null, profileSet: true });
    }
    const org = t.orgId ? { id: t.orgId, name: t.orgName, role: t.role } : null;
    let profileSet = false;
    if (org) profileSet = Boolean((await getCompany().catch(() => null))?.profile?.about);
    return Response.json({
      signedIn: true,
      user: { id: t.userId, email: t.email },
      orgs: t.orgs.map(({ id, name, role }) => ({ id, name, role })),
      org,
      profileSet,
    });
  },
  { needOrg: false }
);
