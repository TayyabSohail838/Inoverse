// Supabase clients for the server only. Never import into a client component.
//
// db()        → the client for the current request: the signed-in user's own client
//               (Row Level Security applies), or the service client for background work.
// serviceDb() → always the service client (bypasses RLS). Only for data the browser must
//               never reach (Google sign-ins, WhatsApp numbers) and for background jobs.
//               Always filter by orgId() when using it.
import { createClient } from "@supabase/supabase-js";
import { tenantOrNull } from "@/lib/tenant";

let client = null;

// The old single-company key. Only used to find the migrated company for the public demo
// and for the legacy WHATSAPP_OWNER_NUMBER setting.
export const LEGACY_SLUG = process.env.COMPANY_SLUG || "inovix";

export const supabaseUrl = () => (process.env.SUPABASE_URL || "").trim();
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
// The public (anon / publishable) key: safe to send to the browser, it can only do what RLS allows.
export const anonKey = () =>
  (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();

export function dbEnabled() {
  return Boolean(client || (supabaseUrl() && serviceKey()));
}

// Database on AND a company chosen for this request. Reads return nothing without it;
// writes refuse (see requireDb in lib/store.js).
export const orgReady = () => dbEnabled() && Boolean(tenantOrNull()?.orgId);

function checkUrl() {
  if (!/^https?:\/\//i.test(supabaseUrl())) {
    throw new Error("SUPABASE_URL must be your project URL (https://<project-id>.supabase.co), not an API key.");
  }
}

export function serviceDb() {
  if (client) return client;
  if (!dbEnabled()) return null;
  checkUrl();
  client = createClient(supabaseUrl(), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function db() {
  return tenantOrNull()?.client || serviceDb();
}

// A client that acts as the signed-in user, so the database itself enforces which
// company's rows they can touch.
export function userDb(accessToken) {
  checkUrl();
  return createClient(supabaseUrl(), anonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Tests swap in a fake client.
export function setDbForTests(fake) {
  client = fake;
}

// Unwrap a Supabase result: return data or throw a readable error.
export function must({ data, error }) {
  if (error) throw new Error(`Database: ${error.message}`);
  return data;
}
