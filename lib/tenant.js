// Which company (organization) the current request is for. Server only.
//
// Every API request runs inside runAsOrg(), set up by route() in lib/http.js from the
// signed-in user (or by the WhatsApp webhook / cron for background work). Code anywhere
// below can then call orgId() without passing it around.
//
// Fails closed: if no organization was set, orgId() throws instead of guessing,
// so a forgotten check can never read or write another company's data.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

// ctx: { orgId, orgName, role, userId, email, client, system }
//   client = Supabase client for this request (the user's own, so RLS applies;
//            the service client for webhooks and cron)
//   system = true for background work with no signed-in user
export function runAsOrg(ctx, fn) {
  return store.run(ctx, fn);
}

export function tenantOrNull() {
  return store.getStore() || null;
}

export function tenant() {
  const t = store.getStore();
  if (!t) throw new Error("No company selected for this request.");
  return t;
}

export function orgId() {
  const id = store.getStore()?.orgId;
  if (!id) throw new Error("No company selected for this request.");
  return id;
}

// For in-memory caches: a key that keeps each company's entries apart.
export const cacheScope = () => store.getStore()?.orgId || "local";

// Keep the current company for work that runs after the response is sent (next/server after()).
export function bindTenant() {
  return AsyncLocalStorage.snapshot();
}
