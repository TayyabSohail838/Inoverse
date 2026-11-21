// Who is asking, and for which company. Server only.
//
// The browser signs in with Supabase Auth and sends its access token as
// "Authorization: Bearer <token>", plus "x-org-id" for the company it has open.
// resolveRequest() checks the token, checks the user belongs to that company,
// and returns the context that runAsOrg() keeps for the rest of the request.
import { createHash } from "node:crypto";
import { anonKey, dbEnabled, serviceDb, userDb, LEGACY_SLUG } from "@/lib/db";
import { isDemo } from "@/lib/demo";

export class AuthError extends Error {
  constructor(message, code, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Sign-in is needed whenever there is a database and this isn't the public demo.
export const authRequired = () => dbEnabled() && !isDemo();
export const authConfigured = () => Boolean(anonKey());

// Checked tokens are kept for up to a minute, so every request doesn't wait on Supabase.
const seen = new Map(); // sha256(token) -> { user, orgs, until }
const MAX_SEEN = 2000;

const hash = (t) => createHash("sha256").update(t).digest("hex");

function tokenExpiry(token) {
  try {
    const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
    return exp ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// Checks the token's signature and expiry. With Supabase's asymmetric signing keys (ES256)
// this happens right here, against the project's public key (fetched once and cached),
// with no network call per request. Older shared-secret projects fall back to asking Supabase.
async function verify(token) {
  const { data, error } = await serviceDb().auth.getClaims(token);
  const c = data?.claims;
  if (error || !c?.sub || c.role !== "authenticated") throw new AuthError("Your sign-in has expired. Sign in again.", "auth");
  return { id: c.sub, email: c.email || "" };
}

// The companies this user belongs to: [{ id, name, role }]
async function membershipsOf(client, userId) {
  let { data, error } = await client
    .from("memberships")
    .select("org_id, role, organizations(id, name, slug, timezone)")
    .eq("user_id", userId)
    .order("created_at");
  if (error && /timezone/i.test(error.message)) {
    // jobs.sql (which adds the time zone) not run yet
    ({ data, error } = await client.from("memberships").select("org_id, role, organizations(id, name, slug)").eq("user_id", userId).order("created_at"));
  }
  if (error) {
    if (/relation .*memberships|schema cache/i.test(error.message)) {
      throw new AuthError("Multi-company tables are missing. Run supabase/multitenant.sql in the Supabase SQL Editor.", "setup", 503);
    }
    throw new Error(`Database: ${error.message}`);
  }
  return (data || []).map((m) => ({
    id: m.org_id,
    name: m.organizations?.name || "Company",
    slug: m.organizations?.slug || null,
    timezone: m.organizations?.timezone || null,
    role: m.role,
  }));
}

// Joins any company that invited this user's confirmed email. Cheap when there are none.
export async function acceptInvites(client) {
  const { data, error } = await client.rpc("accept_invites");
  if (error) console.warn("Invites:", error.message);
  return data || 0;
}

export function forgetToken(token) {
  if (token) seen.delete(hash(token));
}

// Requests that arrive together with the same token (the app loads several panels at once)
// share one check instead of each doing their own.
const checking = new Map(); // sha256(token) -> Promise

function signedIn(token, { fresh = false } = {}) {
  const key = hash(token);
  const hit = seen.get(key);
  if (!fresh && hit && hit.until > Date.now()) return Promise.resolve(hit);
  if (!fresh && checking.has(key)) return checking.get(key);
  const p = check(token, key, hit).finally(() => checking.delete(key));
  if (!fresh) checking.set(key, p);
  return p;
}

async function check(token, key, hit) {
  // re-check the token itself unless it was checked moments ago
  const user = hit && hit.until > Date.now() ? hit.user : await verify(token);
  const client = userDb(token);
  let orgs = await membershipsOf(client, user.id);
  if (!orgs.length && (await acceptInvites(client))) orgs = await membershipsOf(client, user.id);

  const entry = { user, orgs, until: Math.min(Date.now() + 60_000, tokenExpiry(token) || Infinity) };
  // someone with no company yet is about to create or join one: don't keep that answer
  if (orgs.length) {
    if (seen.size >= MAX_SEEN) seen.delete(seen.keys().next().value);
    seen.set(key, entry);
  }
  return entry;
}

// The public demo reads the migrated company (COMPANY_SLUG, default 'inovix') with the
// service key. Writes are refused by demoReadOnly() in the routes.
let demoOrg = null;
async function demoContext() {
  if (!dbEnabled()) return null;
  if (!demoOrg) {
    const { data } = await serviceDb().from("organizations").select("id, name, slug").eq("slug", process.env.DEMO_ORG_SLUG || LEGACY_SLUG).maybeSingle();
    if (!data) return null; // not migrated yet: the demo answers from data/company-context.md
    demoOrg = data;
  }
  return { orgId: demoOrg.id, orgName: demoOrg.name, orgSlug: demoOrg.slug, role: "member", client: serviceDb(), system: true, demo: true };
}

// → context for runAsOrg(), or null when there is no database (single-laptop mode).
// needOrg: false lets signed-in users without a company through (onboarding routes).
export async function resolveRequest(req, { needOrg = true } = {}) {
  if (isDemo()) return demoContext();
  if (!dbEnabled()) return null;
  if (!authConfigured()) {
    throw new AuthError("Sign-in isn't set up yet. Add SUPABASE_ANON_KEY to .env.local and restart.", "setup", 503);
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AuthError("Sign in to use Inoverse.", "auth");

  let me = await signedIn(token);
  const want = req.headers.get("x-org-id") || "";
  let org = want ? me.orgs.find((o) => o.id === want) : me.orgs[0];
  if (want && !org) {
    // maybe they just joined it: look again before saying no
    me = await signedIn(token, { fresh: true });
    org = me.orgs.find((o) => o.id === want) || null;
    if (!org && needOrg) throw new AuthError("You're not a member of that company.", "no_org", 403);
  }
  if (!org && needOrg) throw new AuthError("Create or join a company first.", "no_org", 403);

  return {
    orgId: org?.id || null,
    orgName: org?.name || "",
    orgSlug: org?.slug || null,
    orgTimezone: org?.timezone || null,
    role: org?.role || null,
    orgs: me.orgs,
    userId: me.user.id,
    email: me.user.email,
    token,
    client: userDb(token),
    system: false,
  };
}
