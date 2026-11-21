// GET /api/me → who is signed in and which companies they belong to.
// { signedIn, user: { id, email }, orgs: [{ id, name, role }], org: { id, name, role } | null, profileSet }
// GET /api/me?with=messages also returns { messages } (the saved chat), so the app opens
// with one request instead of two in a row.
// Signed in but no company yet → org: null (the app then asks to create one).
// Joins any company that invited this email on the way (see accept_invites in multitenant.sql).
import { route } from "@/lib/http";
import { tenantOrNull } from "@/lib/tenant";
import { isDemo } from "@/lib/demo";
import { recentMessages } from "@/lib/store";
import { db, orgReady } from "@/lib/db";

// Has the company described itself yet? One small query (not the whole company).
async function profileSet() {
  if (!orgReady()) return true;
  const { data } = await db().from("company_profile").select("about").eq("org_id", tenantOrNull().orgId).maybeSingle();
  return Boolean(data?.about?.trim());
}

export const GET = route(
  async (req) => {
    const t = tenantOrNull();
    const withMessages = new URL(req.url).searchParams.get("with") === "messages";
    if (!t || isDemo()) {
      // single-laptop mode or the public demo: no accounts
      return Response.json({
        signedIn: false,
        demo: isDemo(),
        user: null,
        orgs: [],
        org: t?.orgId ? { id: t.orgId, name: t.orgName, role: "member" } : null,
        profileSet: true,
        ...(withMessages ? { messages: await recentMessages().catch(() => []) } : {}),
      });
    }
    const org = t.orgId ? { id: t.orgId, name: t.orgName, role: t.role, timezone: t.orgTimezone } : null;
    const [set, messages] = await Promise.all([
      org ? profileSet().catch(() => true) : true,
      org && withMessages ? recentMessages().catch(() => []) : null,
    ]);
    return Response.json({
      signedIn: true,
      user: { id: t.userId, email: t.email },
      orgs: t.orgs.map(({ id, name, role }) => ({ id, name, role })),
      org,
      profileSet: set,
      ...(messages ? { messages } : {}),
    });
  },
  { needOrg: false }
);
