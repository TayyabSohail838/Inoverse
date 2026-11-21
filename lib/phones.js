// Which WhatsApp numbers belong to which company. Server only.
//
// One Inovo WhatsApp number serves every company. When a message comes in, the sender's
// phone decides the company. A number only counts once it's verified: the person adds it
// in the app, gets a 6-digit code, and texts "link <code>" to Inovo from that phone.
// That stops anyone from claiming someone else's number and reading their messages.
//
// The whatsapp_numbers table has no RLS policy, so this uses the service client and
// always filters by company.
import { randomInt } from "node:crypto";
import { serviceDb, dbEnabled, must } from "@/lib/db";
import { orgId, tenant } from "@/lib/tenant";
import { InputError } from "@/lib/store";
import { normalisePhone } from "@/lib/people";

const CODE_TTL = 15 * 60 * 1000; // a link code works for 15 minutes

function check(result) {
  if (result.error && /relation .*whatsapp_numbers|schema cache/i.test(result.error.message)) {
    throw new InputError("Run supabase/multitenant.sql in the Supabase SQL Editor first.");
  }
  return must(result);
}

const mask = (p) => `+${p.slice(0, 4)}•••${p.slice(-3)}`;

// The current company's numbers: [{ phone, masked, verified, code? }]
export async function listNumbers() {
  const rows = check(await serviceDb().from("whatsapp_numbers").select("phone, code, verified_at, created_at").eq("org_id", orgId()).order("created_at")) || [];
  return rows.map((r) => ({
    phone: r.phone,
    masked: mask(r.phone),
    verified: Boolean(r.verified_at),
    // the code is only shown to the company that asked for it, until it's used
    code: r.verified_at ? null : r.code,
  }));
}

// Start linking a number to the current company. → { phone, code }
export async function addNumber(raw) {
  const phone = normalisePhone(raw);
  if (!/^\d{8,15}$/.test(phone)) throw new InputError("Enter the full WhatsApp number, like 0300 1234567 or +92 300 1234567.");
  const c = serviceDb();
  const existing = check(await c.from("whatsapp_numbers").select("org_id, verified_at").eq("phone", phone).maybeSingle());
  if (existing?.verified_at) {
    if (existing.org_id === orgId()) throw new InputError("That number is already linked to this company.");
    throw new InputError("That number is already linked to another company. Remove it there first.");
  }
  // an unverified claim proves nothing, so a new request simply replaces it
  const code = String(randomInt(100000, 1000000));
  check(
    await c
      .from("whatsapp_numbers")
      .upsert({ phone, org_id: orgId(), user_id: tenant().userId || null, code, verified_at: null, created_at: new Date().toISOString() }, { onConflict: "phone" })
  );
  return { phone, code };
}

export async function removeNumber(raw) {
  const phone = normalisePhone(raw);
  check(await serviceDb().from("whatsapp_numbers").delete().eq("org_id", orgId()).eq("phone", phone));
}

// ---------- used by the webhook (no signed-in user) ----------

// The company a verified number belongs to, or null.
export async function orgForPhone(phone) {
  if (!dbEnabled()) return null;
  const res = await serviceDb().from("whatsapp_numbers").select("org_id").eq("phone", phone).not("verified_at", "is", null).maybeSingle();
  return res.error ? null : res.data?.org_id || null;
}

// "link 123456" from this phone → verifies it. Returns the company id, or null if the code is wrong or old.
export async function verifyLink(phone, code) {
  if (!dbEnabled()) return null;
  const c = serviceDb();
  const { data } = await c.from("whatsapp_numbers").select("org_id, code, created_at, verified_at").eq("phone", phone).maybeSingle();
  if (!data || data.verified_at || data.code !== code || Date.now() - Date.parse(data.created_at) > CODE_TTL) return null;
  const upd = await c.from("whatsapp_numbers").update({ verified_at: new Date().toISOString(), code: null }).eq("phone", phone).is("verified_at", null);
  return upd.error ? null : data.org_id;
}

// Verified numbers of the current company (morning brief recipients).
export async function verifiedNumbers() {
  if (!dbEnabled()) return [];
  const res = await serviceDb().from("whatsapp_numbers").select("phone").eq("org_id", orgId()).not("verified_at", "is", null);
  return res.error ? [] : res.data.map((r) => r.phone);
}

// Every company with at least one verified number (for the daily brief cron).
export async function orgsWithNumbers() {
  if (!dbEnabled()) return [];
  const res = await serviceDb().from("whatsapp_numbers").select("org_id").not("verified_at", "is", null);
  return res.error ? [] : [...new Set(res.data.map((r) => r.org_id))];
}
