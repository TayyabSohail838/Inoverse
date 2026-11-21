// Browser-side sign-in (Supabase Auth) and which company is open.
// Safe in client components: the URL and anon key come from /api/status and are public;
// what they can reach is decided by Row Level Security on the server.
import { createClient } from "@supabase/supabase-js";

let sb = null;
let config = null; // { url, anonKey }
const ORG_KEY = "inoverse-org";

export function initAuth({ url, anonKey }) {
  if (!sb && url && anonKey) {
    config = { url, anonKey };
    sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
  }
  return sb;
}

export const authClient = () => sb;
export const authConfig = () => config;

// A fresh access token (refreshed by Supabase when it's about to expire), or "".
export async function accessToken() {
  if (!sb) return "";
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

export function getOrgId() {
  try {
    return localStorage.getItem(ORG_KEY) || "";
  } catch {
    return "";
  }
}

export function setOrgId(id) {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {}
}

// Where Supabase sends people back after Google sign-in or an email confirmation link.
export const authRedirect = () => `${window.location.origin}/?auth=callback`;

// Switching company or signing out reloads the page, so nothing from the previous
// company stays on screen or in memory.
export function switchOrg(id) {
  setOrgId(id);
  window.location.assign("/#app");
  window.location.reload();
}

export async function signOut() {
  setOrgId("");
  await sb?.auth.signOut().catch(() => {});
  window.location.assign("/#app");
  window.location.reload();
}
