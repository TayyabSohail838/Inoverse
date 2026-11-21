// Companies, members and invites. Server only.
// Runs as the signed-in user (db() is their own client), so Row Level Security in
// supabase/multitenant.sql has the final say: only owners can invite or remove people.
import { db, must } from "@/lib/db";
import { tenant, orgId } from "@/lib/tenant";
import { InputError } from "@/lib/store";

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// New company with you as its owner. Returns { id, name }.
export async function createOrg(name) {
  const clean = text(name, 200);
  if (!clean) throw new InputError("Give the company a name.");
  const { data, error } = await db().rpc("create_organization", { org_name: clean });
  if (error) throw new InputError(error.message);
  return { id: data.id, name: data.name };
}

// Everyone in the current company, plus invites not yet accepted.
export async function listAccess() {
  const c = db();
  const [members, invites] = await Promise.all([
    c.from("memberships").select("user_id, role, email, created_at").eq("org_id", orgId()).order("created_at"),
    c.from("org_invites").select("id, email, role, created_at").eq("org_id", orgId()).is("accepted_at", null).order("created_at"),
  ]);
  return { members: must(members) || [], invites: must(invites) || [] };
}

export async function invite({ email, role = "member" }) {
  const mail = text(email, 200).toLowerCase();
  if (!EMAIL.test(mail)) throw new InputError("Enter a valid email address.");
  if (!["owner", "member"].includes(role)) throw new InputError("Role must be owner or member.");
  const { members } = await listAccess();
  if (members.some((m) => m.email.toLowerCase() === mail)) throw new InputError(`${mail} is already in this company.`);
  const { data, error } = await db()
    .from("org_invites")
    .insert({ org_id: orgId(), email: mail, role, invited_by: tenant().userId })
    .select("id, email, role, created_at")
    .single();
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new InputError(`${mail} is already invited.`);
    if (/row-level security/i.test(error.message)) throw new InputError("Only an owner of this company can invite people.");
    throw new Error(`Database: ${error.message}`);
  }
  return data;
}

export async function cancelInvite(id) {
  must(await db().from("org_invites").delete().eq("org_id", orgId()).eq("id", id));
}

// Remove someone (owners), or leave the company yourself. The last owner can't leave,
// so a company is never left without anyone who can manage it.
export async function removeMember(userId) {
  const { members } = await listAccess();
  const target = members.find((m) => m.user_id === userId);
  if (!target) throw new InputError("That person isn't in this company.");
  const t = tenant();
  if (userId !== t.userId && t.role !== "owner") throw new InputError("Only an owner can remove people.");
  if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) {
    throw new InputError("A company needs at least one owner. Make someone else an owner first.");
  }
  must(await db().from("memberships").delete().eq("org_id", orgId()).eq("user_id", userId));
}

// The company's time zone (its morning brief arrives at 8:00 there). Owners only.
export function validTimezone(tz) {
  const clean = text(tz, 64);
  if (!clean) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: clean });
    return clean;
  } catch {
    return null;
  }
}

export async function setTimezone(tz, org = orgId()) {
  const clean = validTimezone(tz);
  if (!clean) throw new InputError("That isn't a time zone I know, like Asia/Karachi.");
  const { data, error } = await db().from("organizations").update({ timezone: clean }).eq("id", org).select("timezone");
  if (error) throw new Error(`Database: ${error.message}`);
  if (!data?.length) throw new InputError("Only an owner of this company can change its time zone.");
  return clean;
}

// Keep the company's display name in step with the Company tab (owners only; quietly
// skipped for members, since RLS lets only owners rename).
export async function renameOrg(name) {
  const clean = text(name, 200);
  if (!clean) return;
  await db().from("organizations").update({ name: clean }).eq("id", orgId());
}
