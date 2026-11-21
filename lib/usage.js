// AI usage: limits, tracking and shared model status. Server only.
// Everything lives in Supabase (supabase/usage.sql), so all server copies on Vercel share it.
// If the tables aren't there yet, nothing is blocked: limits let requests through and
// tracking is skipped, so Inovo keeps answering.
import { dbEnabled, serviceDb } from "@/lib/db";
import { tenantOrNull } from "@/lib/tenant";

// ---------- limits ----------
// Units each feature costs. A gap check makes ~8 AI calls, so it costs more than a chat.
export const COST = { chat: 1, "gap-check": 5, voice: 1, transcribe: 1, live: 2, simulate: 1, weekly: 3, draft: 1, whatsapp: 1 };

// Allowances (env, or "off"): per signed-in user per hour, per company per day,
// and per visitor IP per hour where nobody is signed in (the public demo).
const allowance = (name, fallback) => {
  const v = (process.env[name] || "").trim().toLowerCase();
  if (v === "off") return null;
  return Number(v) > 0 ? Number(v) : fallback;
};
export const limits = () => ({
  userHour: allowance("AI_LIMIT_USER_HOUR", 60),
  orgDay: allowance("AI_LIMIT_ORG_DAY", 400),
  ipHour: allowance("AI_LIMIT_IP_HOUR", 30),
});

export class LimitError extends Error {
  constructor(message, resetAt) {
    super(message);
    this.resetAt = resetAt;
  }
}

const HOUR = 3600;
const DAY = 86400;
const ipOf = (req) => (req?.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req?.headers.get("x-real-ip") || "unknown";

// The limits that apply to this request: [{ key, window, limit, label }]
function checks(req) {
  const t = tenantOrNull();
  const l = limits();
  const out = [];
  if (t?.orgId && !t.demo && l.orgDay) out.push({ key: `o:${t.orgId}:d`, window: DAY, limit: l.orgDay, label: "company" });
  if (t?.userId && l.userHour) out.push({ key: `u:${t.userId}:h`, window: HOUR, limit: l.userHour, label: "user" });
  if (!t?.userId && t?.demo && l.ipHour) out.push({ key: `ip:${ipOf(req)}:h`, window: HOUR, limit: l.ipHour, label: "ip" });
  return out;
}

let warned = false;

// Charge this request's feature; throws LimitError when an allowance is used up.
// Also marks the feature on the request, so AI calls below are tracked under it.
export async function spend(feature, req) {
  const t = tenantOrNull();
  if (t) t.feature = feature; // AI calls from here on are tracked under this feature
  if (!dbEnabled()) return; // single-laptop mode: no limits
  const list = checks(req);
  if (!list.length) return;
  const { data, error } = await serviceDb().rpc("ai_spend", {
    p_keys: list.map((c) => c.key),
    p_windows: list.map((c) => c.window),
    p_limits: list.map((c) => c.limit),
    p_cost: COST[feature] || 1,
  });
  if (error) {
    // tables not created yet, or the database is slow: don't stop Inovo over it
    if (!warned) console.warn("AI limits are off:", error.message, "(run supabase/usage.sql)");
    warned = true;
    return;
  }
  if (data?.allowed === false) {
    const which = list.find((c) => c.key === data.key)?.label;
    const when = new Date(data.reset_at).toLocaleTimeString("en-GB", { timeZone: process.env.TIMEZONE || "Asia/Karachi", hour: "2-digit", minute: "2-digit" });
    const msg =
      which === "company"
        ? `Your company has used today's AI allowance. It resets at ${when}.`
        : which === "user"
          ? `You've used this hour's AI allowance. Try again after ${when}.`
          : `The demo has reached its limit for now. Try again after ${when}.`;
    throw new LimitError(msg, data.reset_at);
  }
}

// What's used and left right now, for the Company panel.
export async function allowanceNow() {
  const t = tenantOrNull();
  const l = limits();
  const now = Math.floor(Date.now() / 1000);
  const start = (w) => new Date(Math.floor(now / w) * w * 1000).toISOString();
  const want = [];
  if (t?.orgId && l.orgDay) want.push({ key: `o:${t.orgId}:d`, ws: start(DAY), limit: l.orgDay, name: "companyToday", reset: (Math.floor(now / DAY) + 1) * DAY });
  if (t?.userId && l.userHour) want.push({ key: `u:${t.userId}:h`, ws: start(HOUR), limit: l.userHour, name: "youThisHour", reset: (Math.floor(now / HOUR) + 1) * HOUR });
  const out = {};
  if (!want.length || !dbEnabled()) return out;
  const { data } = await serviceDb().from("ai_limits").select("key, window_start, used").in("key", want.map((w) => w.key));
  for (const w of want) {
    const row = (data || []).find((r) => r.key === w.key && Date.parse(r.window_start) === Date.parse(w.ws));
    out[w.name] = { used: row?.used || 0, limit: w.limit, resetsAt: new Date(w.reset * 1000).toISOString() };
  }
  return out;
}

// ---------- tracking ----------
const timeout = (ms) => new Promise((r) => setTimeout(r, ms));

// One row per AI call. Waits at most 1.5 s and never throws: tracking must not slow
// or break an answer. `usage` is Google's usageMetadata.
export async function recordUsage({ model, usage, ms }) {
  if (!dbEnabled()) return;
  const t = tenantOrNull();
  const row = {
    org_id: t?.orgId || null,
    user_id: t?.userId || null,
    feature: t?.feature || "other",
    model,
    input_tokens: usage?.promptTokenCount || 0,
    output_tokens: (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0),
    ms: Math.round(ms || 0),
    demo: Boolean(t?.demo),
  };
  try {
    await Promise.race([serviceDb().from("ai_usage").insert(row), timeout(1500)]);
  } catch {}
}

// This company's AI use this month, per feature.
export async function monthUsage() {
  const t = tenantOrNull();
  if (!t?.orgId || !dbEnabled()) return [];
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { data, error } = await serviceDb().rpc("org_ai_usage", { p_org: t.orgId, p_since: since.toISOString() });
  return error ? [] : (data || []).map((r) => ({ feature: r.feature, calls: Number(r.calls), tokens: Number(r.tokens) }));
}

// ---------- shared model status ----------
// Which models are busy or out of quota. Kept in memory for speed and in Supabase so every
// server copy knows: re-read at most every 30 s.
const resting = new Map(); // model -> time it can be tried again
let loadedAt = 0;
let loading = null;

async function refresh() {
  if (!dbEnabled() || Date.now() - loadedAt < 30_000) return;
  if (!loading) {
    loading = Promise.race([
      serviceDb()
        .from("ai_model_status")
        .select("model, down_until")
        .gt("down_until", new Date().toISOString())
        .then(({ data }) => {
          for (const r of data || []) resting.set(r.model, Math.max(resting.get(r.model) || 0, Date.parse(r.down_until)));
        }),
      timeout(1000),
    ])
      .catch(() => {})
      .finally(() => {
        loadedAt = Date.now();
        loading = null;
      });
  }
  await loading;
}

export async function restingUntil(model) {
  await refresh();
  return resting.get(model) || 0;
}

export async function rest(model, ms, reason = "") {
  const until = Date.now() + ms;
  resting.set(model, Math.max(resting.get(model) || 0, until));
  if (!dbEnabled()) return;
  try {
    await Promise.race([
      serviceDb()
        .from("ai_model_status")
        .upsert({ model, down_until: new Date(until).toISOString(), reason: String(reason).slice(0, 200), updated_at: new Date().toISOString() }),
      timeout(1000),
    ]);
  } catch {}
}
