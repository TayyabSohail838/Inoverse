// What each kind of background job does. Server only.
//
// step(input, state) runs ONE short step (well under the 60 s limit) and returns
//   { done: true, result }        finished
//   { done: false, state }        more to do: the worker saves `state` and runs the next step
// A step that throws is retried by the worker (lib/worker.js).
// Jobs with a company run inside it (runAsOrg), so data, limits and usage are that company's.
import { buildContext, forgetContext } from "@/lib/context";
import { gapBrief, gapPanel, gapJudge } from "@/lib/gapCheck";
import { saveGapCheck, saveMessages } from "@/lib/store";
import { roleForSkill } from "@/lib/roles";
import { sendBrief, handleIncoming, briefCompanies } from "@/lib/whatsapp";
import { serviceDb } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { tenantOrNull } from "@/lib/tenant";

export const KINDS = {
  // The five-reviewer gap check, in three steps. The progress shown in the app comes from `stage`.
  "gap-check": {
    feature: "gap-check",
    async step({ idea, lang = "en" }, state) {
      if (!state.stage) {
        const context = await buildContext();
        const brief = await gapBrief(idea, context);
        return { done: false, state: { stage: "panel", context, brief } };
      }
      if (state.stage === "panel") {
        const panel = await gapPanel(state.brief, state.context);
        return { done: false, state: { ...state, stage: "judge", panel } };
      }
      const result = await gapJudge({ brief: state.brief, panel: state.panel, context: state.context, lang });
      const ids = await saveGapCheck(idea, result);
      // the full write-up joins the saved chat, and its 48-hour test the company context
      await saveMessages([{ role: "assistant", text: result.details || result.say, skill: "roast" }]).catch(() => {});
      forgetContext(tenantOrNull()?.orgId);
      return { done: true, result: { skill: "roast", role: roleForSkill("roast"), ...result, ...ids } };
    },
  },

  // One company's morning brief on WhatsApp.
  brief: {
    feature: "brief",
    async step() {
      return { done: true, result: await sendBrief() };
    },
  },

  // One incoming WhatsApp message (handleIncoming finds the sender's company itself).
  "whatsapp-message": {
    feature: "whatsapp",
    async step({ msg }) {
      await handleIncoming(msg);
      return { done: true, result: { ok: true } };
    },
  },
};

// ---------- the schedule (runs on every worker tick) ----------

// "2026-11-21" and the hour (0-23) in a time zone
function localNow(timeZone) {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date())
        .map((x) => [x.type, x.value])
    );
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
  } catch {
    return localNow("Asia/Karachi");
  }
}

// Adds the jobs that are due now. Each has a dedupe key, so running this every minute
// (or twice at once) never adds the same job twice.
export async function schedule() {
  const added = { briefs: 0 };

  // Morning briefs: once a day per company, between 8:00 and 11:59 in its own time zone
  // (the window means a brief still goes out if the schedule was briefly down at 8:00).
  const orgs = await briefCompanies().catch(() => []);
  if (orgs.length) {
    const { data } = await serviceDb().from("organizations").select("id, timezone").in("id", orgs);
    for (const o of data || []) {
      const { date, hour } = localNow(o.timezone || process.env.TIMEZONE || "Asia/Karachi");
      if (hour >= 8 && hour < 12 && (await enqueue("brief", {}, { org: o.id, user: null, dedupe: `brief:${o.id}:${date}` }))) added.briefs++;
    }
  }

  // Gmail is not scheduled here: the app checks it only while it's open (CofounderApp, every 5 minutes).

  // Finished jobs are kept a week for checking, then cleared.
  await serviceDb()
    .from("jobs")
    .delete()
    .in("status", ["done", "failed"])
    .lt("updated_at", new Date(Date.now() - 7 * 864e5).toISOString());

  return added;
}
