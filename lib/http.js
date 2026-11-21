// Small helpers shared by every API route.
import { InputError } from "@/lib/store";
import { DemoError } from "@/lib/demo";
import { AuthError, resolveRequest } from "@/lib/auth";
import { runAsOrg, tenant, tenantOrNull } from "@/lib/tenant";
import { spend, LimitError } from "@/lib/usage";
import { forgetContext } from "@/lib/context";

// Optional access code (single-laptop mode without a database): set ACCESS_CODE before sharing a link.
export function guard(req) {
  const code = process.env.ACCESS_CODE;
  if (!code) return null;
  if (req.headers.get("x-access-code") === code) return null;
  return Response.json({ error: "Access code required.", code: "access_code" }, { status: 401 });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new InputError("Request body must be JSON.");
  }
}

// Only the company's owners may do this (invite people, remove members, rename).
export function requireOwner() {
  const t = tenant();
  if (t.demo || t.system || t.role === "owner") return;
  throw new AuthError("Only an owner of this company can do that.", "forbidden", 403);
}

// Wrap a route handler: access check, sign-in, company, AI allowance, consistent errors.
// needOrg: false = signed in is enough (creating or joining a company).
// ai: the feature this route uses AI for ("chat", "voice", …): charged against the
//     user's and company's allowance before any work starts (lib/usage.js).
export function route(handler, { needOrg = true, ai = null } = {}) {
  const run = async (req, ctx) => {
    if (ai) await spend(ai, req);
    const res = await handler(req, ctx);
    // anything that changes company data makes Inovo re-read it on the next answer
    if (!ai && req.method !== "GET") forgetContext(tenantOrNull()?.orgId);
    return res;
  };
  return async (req, ctx) => {
    const denied = guard(req);
    if (denied) return denied;
    try {
      const who = await resolveRequest(req, { needOrg });
      return who ? await runAsOrg(who, () => run(req, ctx)) : await run(req, ctx);
    } catch (err) {
      if (err instanceof InputError) return Response.json({ error: err.message }, { status: 400 });
      if (err instanceof DemoError) return Response.json({ error: err.message, demo: true }, { status: 403 });
      if (err instanceof AuthError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof LimitError) return Response.json({ error: err.message, code: "limit", resetAt: err.resetAt }, { status: 429 });
      console.error(err);
      // busy = Google's AI is overloaded: a short "try again" message, not a crash
      if (err.busy) return Response.json({ error: err.message }, { status: 503 });
      // database and other internal errors stay in the server log, not on the screen
      const safe = /^(Database:|relation |permission denied)/i.test(err.message || "") ? "Something went wrong saving or loading that. Try again." : err.message;
      return Response.json({ error: safe || "Something went wrong." }, { status: 500 });
    }
  };
}

// Next.js 15 passes params as a promise; awaiting also works on Next.js 14.
export async function idFrom(ctx) {
  const params = await ctx?.params;
  const id = params?.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("Invalid id.");
  return id;
}
