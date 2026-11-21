// Upcoming tasks: what Inovo keeps in mind before every answer.
// Tasks come from marked Gmail emails or the Tasks tab.
import { db, serviceDb, dbEnabled, orgReady, must } from "@/lib/db";
import { orgId } from "@/lib/tenant";
import { demoReadOnly } from "@/lib/demo";
import { InputError } from "@/lib/store";
import { seal, open, needsReseal } from "@/lib/secretbox";

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Friendly error when the tables from supabase/tasks.sql haven't been created yet.
function check(result) {
  if (result.error && /relation .*tasks|relation .*integrations|schema cache/i.test(result.error.message)) {
    throw new InputError("The tasks tables aren't set up yet. Run supabase/people.sql in the Supabase SQL Editor.");
  }
  return must(result);
}

function requireDb() {
  if (!dbEnabled()) throw new InputError("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local.");
  demoReadOnly(); // the public demo never saves
  orgId(); // writes always need a company
  return db();
}

function toDue(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Open tasks, soonest first (tasks with no date last). includeDone adds recent finished ones.
export async function listTasks({ includeDone = false } = {}) {
  if (!orgReady()) return [];
  let q = db().from("tasks").select("*").eq("org_id", orgId());
  if (!includeDone) q = q.eq("status", "open");
  const res = await q.order("due_at", { ascending: true, nullsFirst: false }).order("created_at").limit(200);
  // Inovo should still answer if the tables are missing: treat as no tasks
  if (res.error && !includeDone) return [];
  return check(res) || [];
}

export async function addTask({ title, notes, due_at, source = "manual", source_id = null }) {
  const c = requireDb();
  if (!text(title, 300)) throw new InputError("Give the task a title.");
  const row = {
    org_id: orgId(),
    title: text(title, 300),
    notes: text(notes, 2000),
    due_at: toDue(due_at),
    source,
    source_id,
  };
  return check(await c.from("tasks").insert(row).select().single());
}

export async function updateTask(id, { title, notes, due_at, status }) {
  const c = requireDb();
  const patch = {};
  if (title !== undefined) patch.title = text(title, 300);
  if (notes !== undefined) patch.notes = text(notes, 2000);
  if (due_at !== undefined) patch.due_at = toDue(due_at);
  if (status !== undefined) {
    if (!["open", "done"].includes(status)) throw new InputError("Status must be open or done.");
    patch.status = status;
  }
  return check(await c.from("tasks").update(patch).eq("org_id", orgId()).eq("id", id).select().single());
}

export async function removeTask(id) {
  const c = requireDb();
  check(await c.from("tasks").delete().eq("org_id", orgId()).eq("id", id));
}

// Which Gmail messages have already become tasks (so each email is read once).
export async function knownSourceIds(ids) {
  if (!ids.length) return new Set();
  const rows = check(await requireDb().from("tasks").select("source_id").eq("org_id", orgId()).in("source_id", ids));
  return new Set((rows || []).map((r) => r.source_id));
}

// ---------- Google connection ----------
// Refresh tokens are server-only: the integrations table has no RLS policy, so these use
// the service client and always filter by the current company. They're stored encrypted
// (lib/secretbox.js); callers always get the plain token.
export async function getIntegration(provider) {
  if (!orgReady()) return null;
  const row = check(await serviceDb().from("integrations").select("*").eq("org_id", orgId()).eq("provider", provider).maybeSingle());
  if (!row?.refresh_token) return row;
  const stored = row.refresh_token;
  row.refresh_token = open(stored);
  // saved before encryption (or with an old key): re-save it encrypted, in the background
  if (needsReseal(stored)) {
    serviceDb()
      .from("integrations")
      .update({ refresh_token: seal(row.refresh_token) })
      .eq("org_id", row.org_id)
      .eq("provider", provider)
      .eq("refresh_token", stored)
      .then(({ error }) => error && console.warn("Couldn't encrypt the saved Google key:", error.message));
  }
  return row;
}

export async function saveIntegration(provider, { account, refresh_token, scopes = "" }) {
  requireDb();
  const c = serviceDb();
  const row = { org_id: orgId(), provider, account: text(account, 200), refresh_token: seal(refresh_token), scopes };
  let res = await c.from("integrations").upsert(row, { onConflict: "org_id,provider" }).select().single();
  if (res.error && /scopes/i.test(res.error.message)) {
    // supabase/people.sql not run yet: save without the scopes column (calendar stays off)
    delete row.scopes;
    res = await c.from("integrations").upsert(row, { onConflict: "org_id,provider" }).select().single();
  }
  const saved = check(res);
  return saved ? { ...saved, refresh_token } : saved;
}

export async function markSynced(provider) {
  check(
    await (requireDb(), serviceDb())
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("org_id", orgId())
      .eq("provider", provider)
  );
}

export async function removeIntegration(provider) {
  check(await (requireDb(), serviceDb()).from("integrations").delete().eq("org_id", orgId()).eq("provider", provider));
}
