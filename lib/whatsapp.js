// Inovo on WhatsApp (Meta WhatsApp Business Cloud API). Server only.
// You text Inovo → it answers like in the app, and saves any task, meeting or
// person you mention. Voice notes work too. Every morning it can send a brief.
//
// One Inovo number serves every company: the sender's verified phone decides which
// company's data Inovo uses (see lib/phones.js). Numbers in WHATSAPP_OWNER_NUMBER still
// work for the migrated company (COMPANY_SLUG). Every request must be signed by Meta
// with WHATSAPP_APP_SECRET.
import { createHmac, timingSafeEqual } from "node:crypto";
import { gemma, transcribe } from "@/lib/gemma";
import { buildContext } from "@/lib/context";
import { addTask, listTasks } from "@/lib/tasks";
import { dueFromLocal, nowText, TIMEZONE, upcomingMeetings, meetingTime } from "@/lib/google";
import {
  STAGES,
  addContact,
  updateContact,
  findContactByName,
  listContacts,
  normalisePhone,
  logWhatsApp,
  recentWhatsApp,
  lastInboundAt,
} from "@/lib/people";
import { orgForPhone, verifyLink, verifiedNumbers, orgsWithNumbers } from "@/lib/phones";
import { runAsOrg, tenantOrNull } from "@/lib/tenant";
import { dbEnabled, serviceDb, LEGACY_SLUG } from "@/lib/db";

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}`;

export const whatsappConfigured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_APP_SECRET);

// Legacy setting: numbers allowed for the migrated company without linking in the app.
const owners = () => (process.env.WHATSAPP_OWNER_NUMBER || "").split(",").map(normalisePhone).filter(Boolean);

let legacyOrg; // id of the migrated company (COMPANY_SLUG), looked up once
async function legacyOrgId() {
  if (legacyOrg !== undefined || !dbEnabled()) return legacyOrg || null;
  const { data } = await serviceDb().from("organizations").select("id").eq("slug", LEGACY_SLUG).maybeSingle();
  legacyOrg = data?.id || null;
  return legacyOrg;
}

// Who gets the current company's brief: its verified numbers, plus the legacy owner
// numbers if this is the migrated company.
export async function briefRecipients() {
  const list = await verifiedNumbers();
  const t = tenantOrNull();
  if (!t?.orgId || t.orgId === (await legacyOrgId())) list.push(...owners());
  return [...new Set(list)];
}

// Meta signs each webhook call: X-Hub-Signature-256 = sha256 HMAC of the raw body.
export function signatureOk(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

async function graph(path, body) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${data.error?.message || "request failed"}`);
  return data;
}

export async function sendText(to, text) {
  const body = String(text).slice(0, 4000);
  const r = await graph(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: false },
  });
  await logWhatsApp(r.messages?.[0]?.id || `out-${Date.now()}`, "out", body);
  return r;
}

// Messages Inovo starts after 24 h of silence must use a template Meta approved,
// with one {{1}} in the body. Template values can't contain line breaks.
async function sendTemplate(to, text) {
  const name = process.env.WHATSAPP_BRIEF_TEMPLATE;
  const flat = String(text).replace(/\s*\n+\s*/g, " · ").replace(/\s{4,}/g, " ").slice(0, 1000);
  const r = await graph(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: process.env.WHATSAPP_BRIEF_TEMPLATE_LANG || "en" },
      components: [{ type: "body", parameters: [{ type: "text", text: flat }] }],
    },
  });
  await logWhatsApp(r.messages?.[0]?.id || `out-${Date.now()}`, "out", flat);
  return r;
}

// Voice note → text, using the same transcription as the Talk button.
async function voiceNoteText(mediaId) {
  const meta = await graph(mediaId);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
  if (!res.ok) throw new Error(`Couldn't download the voice note (${res.status})`);
  const audio = Buffer.from(await res.arrayBuffer()).toString("base64");
  return transcribe(audio, (meta.mime_type || "audio/ogg").split(";")[0], "en");
}

// ---------- one incoming message ----------
export async function handleIncoming(msg) {
  const from = normalisePhone(msg.from);

  // "link 123456": connect this phone to the company that asked for the code in the app
  const link = msg.type === "text" && (msg.text?.body || "").match(/^\s*link\s+(\d{6})\s*$/i);
  if (link) {
    const org = await verifyLink(from, link[1]);
    return sendText(
      from,
      org
        ? "Linked, boss. This number now talks to your company in Inoverse. Text me tasks, meetings and people, or send \"brief\" for today's plan."
        : "That code didn't work. Open Inoverse → Company → WhatsApp, add your number again and send the new code."
    );
  }

  const org = (await orgForPhone(from)) || (owners().includes(from) ? await legacyOrgId() : null);
  if (org) return runAsOrg({ orgId: org, client: serviceDb(), system: true }, () => answer(msg, from));
  // no database at all: the legacy owner numbers still work, with nothing saved
  if (!dbEnabled() && owners().includes(from)) return answer(msg, from);
  console.warn(`WhatsApp: ignored a message from ${from.slice(0, 4)}… (number not linked to a company)`);
}

// One message from a known number, inside its company.
async function answer(msg, from) {
  let text = "";
  if (msg.type === "text") text = msg.text?.body || "";
  else if (msg.type === "audio") {
    try {
      text = await voiceNoteText(msg.audio.id);
    } catch (err) {
      console.warn("WhatsApp voice note:", err.message);
      return sendText(from, "I couldn't hear that voice note, boss. Could you type it?");
    }
  } else {
    return sendText(from, "I can read text and voice notes for now, boss.");
  }
  text = text.trim();
  if (!(await logWhatsApp(msg.id, "in", text))) return; // WhatsApp sent it twice
  if (!text) return;

  if (/^\s*(brief|today|aaj)\s*[?!.]*\s*$/i.test(text)) {
    return sendText(from, await morningBrief());
  }

  const [context, history] = await Promise.all([buildContext({ demo: false }), recentWhatsApp(10)]);
  const convo = history
    .filter((m) => m.id !== msg.id)
    .map((m) => `${m.direction === "in" ? "Founder" : "Inovo"}: ${m.text}`)
    .join("\n");

  let out;
  try {
    out = await gemma(
      `${convo ? `RECENT WHATSAPP CHAT:\n${convo}\n\n` : ""}NEW MESSAGE FROM THE FOUNDER: """${text}"""

Today is ${nowText()} (${TIMEZONE}). Reply with ONLY this JSON:
{"reply": "your WhatsApp reply: warm and short, 1-4 sentences, plain text (you may use *bold*). Answer in the same language the founder used (English, Urdu or Roman Urdu). If you saved something, say so in a few words.",
 "tasks": [{"title": "short task or meeting", "due": "YYYY-MM-DDTHH:mm local time, YYYY-MM-DD, or null", "notes": ""}],
 "contacts": [{"name": "", "phone": "", "org": "", "role": "", "stage": "one of ${STAGES.join(" | ")} or empty", "next_followup": "YYYY-MM-DD or null", "notes": "what to remember about them"}]}
Only fill "tasks" when the founder wants something remembered or reminded (a task, deadline or meeting).
Only fill "contacts" when the founder mentions a person to track or update (a lead, client, partner). Otherwise use empty lists.`,
      {
        system: `You are Inovo, the AI cofounder inside INOVERSE, chatting with the founder ("boss") on WhatsApp. Supportive, honest, practical. Don't nag about pending projects.\n\n# COMPANY CONTEXT\n${context}`,
        temperature: 0.5,
        json: true,
        fast: true,
      }
    );
  } catch (err) {
    console.warn("WhatsApp reply:", err.message);
    return sendText(from, "My brain is busy for a moment, boss. Try again in a minute.");
  }

  const saved = [];
  for (const t of Array.isArray(out?.tasks) ? out.tasks.slice(0, 5) : []) {
    if (!t?.title) continue;
    await addTask({ title: t.title, notes: t.notes || "", due_at: dueFromLocal(t.due), source: "whatsapp" })
      .then(() => saved.push("task"))
      .catch((e) => console.warn("WhatsApp task:", e.message));
  }
  for (const c of Array.isArray(out?.contacts) ? out.contacts.slice(0, 5) : []) {
    if (!c?.name) continue;
    const fields = {
      name: c.name,
      ...(c.phone ? { phone: c.phone } : {}),
      ...(c.org ? { org: c.org } : {}),
      ...(c.role ? { role: c.role } : {}),
      ...(STAGES.includes(c.stage) ? { stage: c.stage } : {}),
      ...(c.next_followup ? { next_followup_at: dueFromLocal(String(c.next_followup).slice(0, 10)) } : {}),
    };
    try {
      const existing = await findContactByName(c.name);
      if (existing) {
        const notes = c.notes ? [existing.notes, c.notes].filter(Boolean).join("\n") : undefined;
        await updateContact(existing.id, { ...fields, ...(notes !== undefined ? { notes } : {}) });
      } else {
        await addContact({ ...fields, notes: c.notes || "" }, "whatsapp");
      }
      saved.push("contact");
    } catch (e) {
      console.warn("WhatsApp contact:", e.message);
    }
  }

  await sendText(from, out?.reply || (saved.length ? "Saved, boss." : "Got it, boss."));
}

// ---------- the morning brief ----------
// Today's meetings, tasks due today or overdue, and people to follow up with.
export async function morningBrief() {
  const endOfToday = new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE }));
  endOfToday.setHours(23, 59, 59, 999);
  const offsetMs = new Date().getTime() - new Date(new Date().toLocaleString("en-US", { timeZone: TIMEZONE })).getTime();
  const todayEnd = endOfToday.getTime() + offsetMs;

  const [tasks, contacts, cal] = await Promise.all([
    listTasks().catch(() => []),
    listContacts().catch(() => []),
    upcomingMeetings({ days: 1, fresh: true }).catch(() => null),
  ]);
  const due = tasks.filter((t) => t.due_at && Date.parse(t.due_at) <= todayEnd);
  const follow = contacts.filter((c) => c.next_followup_at && Date.parse(c.next_followup_at) <= todayEnd);
  const meetings = (cal?.meetings || []).filter((m) => m.start && Date.parse(m.start) <= todayEnd);

  const lines = [`*Good morning, boss.* Here's today in INOVERSE:`];
  if (meetings.length) lines.push("", "*Meetings*", ...meetings.map((m) => `• ${meetingTime(m).split(", ").pop()} ${m.title}`));
  if (due.length) lines.push("", "*Tasks*", ...due.slice(0, 8).map((t) => `• ${t.title}${Date.parse(t.due_at) < Date.now() ? " (overdue)" : ""}`));
  if (follow.length) lines.push("", "*Follow up with*", ...follow.slice(0, 8).map((c) => `• ${c.name}${c.org ? ` (${c.org})` : ""}`));
  if (!meetings.length && !due.length && !follow.length) lines.push("", "Nothing scheduled. A good day to reach out to one new lead.");
  lines.push("", "Reply here to add a task or a person.");
  return lines.join("\n");
}

// Send the brief to the owner: free text if they messaged in the last 24 hours,
// otherwise the approved template (WHATSAPP_BRIEF_TEMPLATE).
// Sent to every verified number of the current company.
export async function sendBrief() {
  const recipients = await briefRecipients();
  if (!recipients.length) throw new Error("Link a WhatsApp number first (Company → WhatsApp).");
  const brief = await morningBrief();
  const last = await lastInboundAt();
  const recent = last && Date.now() - Date.parse(last) < 23.5 * 3600 * 1000;
  const template = Boolean(process.env.WHATSAPP_BRIEF_TEMPLATE);
  const via = [];
  for (const to of recipients) {
    try {
      // free text only works inside the 24-hour window; fall back to the template
      if (recent) {
        try {
          await sendText(to, brief);
          via.push("message");
          continue;
        } catch (err) {
          if (!template) throw err;
        }
      }
      if (template) {
        await sendTemplate(to, brief);
        via.push("template");
      }
    } catch (err) {
      console.warn(`WhatsApp brief to ${to.slice(0, 4)}…:`, err.message);
    }
  }
  if (via.length) return { sent: true, via: via.includes("template") ? "template" : "message", count: via.length };
  return {
    sent: false,
    reason: "WhatsApp only lets Inovo message you first with an approved template. Text Inovo once a day, or set WHATSAPP_BRIEF_TEMPLATE (see README).",
  };
}

// The daily cron: one brief per company that has a linked number.
// Runs them one after another; with many companies this belongs in a job queue.
export async function sendAllBriefs() {
  const orgs = new Set(await orgsWithNumbers());
  if (owners().length && (await legacyOrgId())) orgs.add(await legacyOrgId());
  const results = [];
  for (const org of orgs) {
    try {
      results.push({ org, ...(await runAsOrg({ orgId: org, client: serviceDb(), system: true }, sendBrief)) });
    } catch (err) {
      results.push({ org, sent: false, reason: err.message });
    }
  }
  return { companies: results.length, sent: results.filter((r) => r.sent).length, results };
}
