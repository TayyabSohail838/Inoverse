// Rate limits for actions that could be abused by repeating them fast: creating companies,
// sending invites, adding WhatsApp numbers, guessing link codes, and writes in general.
// Server only.
//
// Uses the same shared counters as the AI allowance (ai_spend in supabase/usage.sql), so
// every server copy on Vercel counts together. If those aren't set up, it falls back to
// counting in this server's memory, which still slows down a single attacker.
import { dbEnabled, serviceDb } from "@/lib/db";
import { tenantOrNull } from "@/lib/tenant";
import { LimitError } from "@/lib/usage";

// name → [how many, per how many seconds, what to call it in the message]
export const RULES = {
  write: [120, 60, "changes"], // any save, per person
  "create-org": [5, 3600, "new companies"],
  invite: [30, 3600, "invites"],
  "add-number": [10, 3600, "WhatsApp numbers"],
  "google-connect": [10, 600, "Google connections"],
  "link-code": [5, 900, "link codes"], // per phone texting "link <code>"
};

export const ipOf = (req) => (req?.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req?.headers.get("x-real-ip") || "unknown";

// who the limit counts against: the signed-in person, else their IP address
function whoKey(req) {
  const t = tenantOrNull();
  return t?.userId ? `u:${t.userId}` : `ip:${ipOf(req)}`;
}

const memory = new Map(); // key → { start, used }
function memoryHit(key, limit, windowSecs) {
  const now = Date.now();
  const start = Math.floor(now / (windowSecs * 1000)) * windowSecs * 1000;
  const m = memory.get(key);
  const used = m && m.start === start ? m.used : 0;
  if (memory.size > 5000) for (const [k, v] of memory) if (v.start < start) memory.delete(k);
  if (used + 1 > limit) return { allowed: false, resetAt: new Date(start + windowSecs * 1000).toISOString() };
  memory.set(key, { start, used: used + 1 });
  return { allowed: true };
}

// Count one more `name` action; false (or a LimitError with throwIt) when over the limit.
// who: what to count against (defaults to the signed-in person, else the IP address).
export async function hit(name, req, { who, throwIt = true } = {}) {
  const rule = RULES[name];
  if (!rule) throw new Error(`Unknown rate limit: ${name}`);
  const [limit, windowSecs, label] = rule;
  const key = `rl:${name}:${who || whoKey(req)}`;

  let res = null;
  if (dbEnabled()) {
    const { data, error } = await serviceDb().rpc("ai_spend", { p_keys: [key], p_windows: [windowSecs], p_limits: [limit], p_cost: 1 });
    if (!error) res = data?.allowed === false ? { allowed: false, resetAt: data.reset_at } : { allowed: true };
  }
  if (!res) res = memoryHit(key, limit, windowSecs);

  if (res.allowed) return true;
  if (!throwIt) return false;
  const mins = Math.max(1, Math.ceil((Date.parse(res.resetAt) - Date.now()) / 60000));
  throw new LimitError(`Too many ${label} in a short time. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, res.resetAt);
}
