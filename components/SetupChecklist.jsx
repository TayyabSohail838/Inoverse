"use client";
// "Set up your company": a short checklist for a company's owner, shown on the main screen
// until everything is done (or they hide it). Each step is one click: it opens the right
// panel, or goes straight to Google for Gmail + Calendar. Steps tick themselves off.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

const hiddenKey = (org) => `inoverse-setup-hidden:${org}`;
const readHidden = (org) => {
  try {
    return localStorage.getItem(hiddenKey(org)) === "1";
  } catch {
    return false;
  }
};

export default function SetupChecklist({ me, status, tab, onOpen }) {
  const org = me?.org?.id;
  const isOwner = me?.org?.role === "owner";
  const [info, setInfo] = useState(null);
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (org) setHidden(readHidden(org));
  }, [org]);

  const load = useCallback(async () => {
    if (!org || !isOwner) return;
    const [google, numbers, wa, access] = await Promise.all([
      api("/api/google").catch(() => null),
      api("/api/whatsapp/numbers").catch(() => null),
      api("/api/whatsapp/status").catch(() => null),
      api("/api/orgs/access").catch(() => null),
    ]);
    setInfo({ google, numbers: numbers?.numbers || [], wa, access });
  }, [org, isOwner]);

  // on open, whenever a panel closes (something may have changed), and when coming back to the tab
  useEffect(() => {
    if (!hidden && tab === null) load();
  }, [hidden, tab, load]);
  useEffect(() => {
    if (hidden) return;
    const again = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [hidden, load]);

  if (!org || !isOwner || hidden || status?.demo || !info) return null;

  async function connectGoogle() {
    setError("");
    try {
      const { url } = await api("/api/google/connect", { method: "POST" });
      window.location.assign(url);
    } catch (e) {
      setError(e.message);
    }
  }

  const steps = [
    {
      key: "profile",
      title: "Tell Inovo about your company",
      done: Boolean(me.profileSet),
      action: <button className="link" onClick={() => onOpen("company")}>Open Company</button>,
    },
    info.google?.configured && {
      key: "google",
      title: "Connect Gmail + Calendar",
      hint: "One click: choose your Google account and press Allow.",
      done: Boolean(info.google.connected && info.google.calendar),
      action: <button className="link" onClick={connectGoogle}>{info.google.connected ? "Add Calendar" : "Connect"}</button>,
    },
    info.wa?.configured && {
      key: "whatsapp",
      title: "Link your WhatsApp",
      hint: "Add your number, then tap Open WhatsApp and press Send.",
      done: info.numbers.some((n) => n.verified),
      action: <button className="link" onClick={() => onOpen("company")}>Link</button>,
    },
    {
      key: "team",
      title: "Invite your team",
      done: (info.access?.members?.length || 0) > 1 || (info.access?.invites?.length || 0) > 0,
      action: <button className="link" onClick={() => onOpen("company")}>Invite</button>,
    },
  ].filter(Boolean);

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(org), "1");
    } catch {}
    setHidden(true);
  };

  return (
    <section className="setup" aria-labelledby="setup-title">
      <div className="setup-head">
        <button className="setup-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span id="setup-title">Set up {me.org.name}</span>
          <span className="muted">{doneCount} of {steps.length} done</span>
        </button>
        <button className="link" onClick={hide} aria-label="Hide the setup checklist">Hide</button>
      </div>
      <span className="meter" role="meter" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} style={{ "--w": `${(doneCount / steps.length) * 100}%` }} />
      {open && (
        <ol className="setup-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.done ? "done" : ""}>
              <span className="setup-check" aria-hidden="true">{s.done ? "✓" : ""}</span>
              <span className="setup-text">
                <span className="item-title">{s.title}</span>
                {!s.done && s.hint && <span className="muted">{s.hint}</span>}
              </span>
              {s.done ? <span className="muted">Done</span> : s.action}
            </li>
          ))}
        </ol>
      )}
      {error && <p className="flash error" role="alert">{error}</p>}
    </section>
  );
}
