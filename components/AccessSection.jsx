"use client";
// Company → Access: who you are, which company is open, who's in it, and which
// WhatsApp numbers talk to Inovo for it. Owners invite and remove people.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { switchOrg, signOut } from "@/lib/session";

export default function AccessSection({ me }) {
  const isOwner = me?.org?.role === "owner";
  const [access, setAccess] = useState(null);
  const [numbers, setNumbers] = useState([]);
  const [bot, setBot] = useState("");
  const [usage, setUsage] = useState(null);
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [phone, setPhone] = useState("");
  const [newOrg, setNewOrg] = useState("");
  const [tz, setTz] = useState(me?.org?.timezone || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, n, wa, u] = await Promise.all([
        api("/api/orgs/access"),
        api("/api/whatsapp/numbers").catch(() => ({ numbers: [] })),
        api("/api/whatsapp/status").catch(() => null),
        api("/api/usage").catch(() => null),
      ]);
      setUsage(u);
      setAccess(a);
      setNumbers(n.numbers || []);
      setBot(wa?.botNumber || "");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // one change at a time, then re-read
  const call = async (what, fn, msg) => {
    if (busy) return false;
    setBusy(what);
    setError("");
    setSaved("");
    try {
      await fn();
      if (msg) setSaved(msg);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy("");
    }
  };

  if (!me?.signedIn) return null;
  const pending = numbers.filter((n) => !n.verified);

  return (
    <section className="stack access" aria-labelledby="access-title">
      <h2 id="access-title">Access</h2>
      {(error || saved) && (
        <p className={`flash ${error ? "error" : "ok"}`} role={error ? "alert" : "status"}>
          {error || saved}
        </p>
      )}

      <div className="card">
        <p className="item-title">{me.user.email}</p>
        <p className="muted">
          {isOwner ? "Owner" : "Member"} of {me.org?.name}
        </p>
        <div className="row">
          {me.orgs.length > 1 && (
            <label>
              Open company
              <select value={me.org?.id} onChange={(e) => switchOrg(e.target.value)}>
                {me.orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {me.org?.timezone && (
        <form
          className="row form"
          onSubmit={async (e) => {
            e.preventDefault();
            await call("tz", () => api("/api/orgs", { method: "PATCH", body: { timezone: tz.trim() } }), `Time zone set to ${tz.trim()}. The morning brief comes at 8:00 there.`);
          }}
        >
          <label>
            Company time zone (morning brief at 8:00 here)
            <input list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} disabled={!isOwner} placeholder="Asia/Karachi" />
          </label>
          <datalist id="tz-list">
            {(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []).map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          {isOwner && <button className="btn quiet" disabled={!!busy || !tz.trim() || tz.trim() === me.org.timezone}>{busy === "tz" ? "Saving…" : "Save"}</button>}
        </form>
      )}

      <h2>People with access</h2>
      <ul className="list compact">
        {(access?.members || []).map((m) => {
          const self = m.user_id === access.me?.id;
          return (
            <li key={m.user_id} className="history">
              <span className="item-title">{m.email || "Teammate"}{self && " (you)"}</span>
              <span className="muted">{m.role}</span>
              {(isOwner || self) && (
                <button
                  className="link danger"
                  disabled={!!busy}
                  onClick={() => {
                    if (self && !window.confirm(`Leave ${me.org?.name}? You'll lose access to its data.`)) return;
                    call("member", () => api(`/api/orgs/access/${m.user_id}`, { method: "DELETE" }), self ? "" : `${m.email} removed.`).then(
                      (ok) => ok && self && switchOrg("")
                    );
                  }}
                >
                  {self ? "Leave" : "Remove"}
                </button>
              )}
            </li>
          );
        })}
        {(access?.invites || []).map((i) => (
          <li key={i.id} className="history">
            <span className="item-title">{i.email}</span>
            <span className="muted">invited · {i.role}</span>
            {isOwner && (
              <button
                className="link danger"
                disabled={!!busy}
                onClick={() => call("invite", () => api(`/api/orgs/access/${i.id}?kind=invite`, { method: "DELETE" }), `Invite to ${i.email} cancelled.`)}
              >
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          className="row form"
          onSubmit={async (e) => {
            e.preventDefault();
            const mail = invite.email.trim();
            const ok = await call(
              "invite",
              () => api("/api/orgs/access", { method: "POST", body: { ...invite, email: mail } }),
              `${mail} invited. They join when they sign in with that email.`
            );
            if (ok) setInvite({ email: "", role: "member" });
          }}
        >
          <label>
            Invite by email
            <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="teammate@company.com" />
          </label>
          <label>
            Role
            <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          </label>
          <button className="btn quiet" disabled={!!busy || !invite.email.trim()}>{busy === "invite" ? "Inviting…" : "Invite"}</button>
        </form>
      )}

      <h2>WhatsApp</h2>
      <p className="muted">
        Numbers linked here can text Inovo, and Inovo answers with this company's data. Each number belongs to one company.
      </p>
      <ul className="list compact">
        {numbers.map((n) => (
          <li key={n.phone} className="history">
            <span className="item-title">{n.masked}</span>
            <span className="muted">{n.verified ? "linked" : "waiting for code"}</span>
            <button
              className="link danger"
              disabled={!!busy}
              onClick={() => call("phone", () => api("/api/whatsapp/numbers", { method: "DELETE", body: { phone: n.phone } }), `${n.masked} unlinked.`)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {pending.map((n) => (
        <div key={n.phone} className="card link-code">
          <p className="muted">From {n.masked}, send this to Inovo on WhatsApp{bot ? ` (${bot})` : ""}:</p>
          <p className="code">link {n.code}</p>
          <p className="muted">The code works for 15 minutes. If it runs out, add the number again for a new one.</p>
        </div>
      ))}
      <form
        className="row form"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await call("phone", () => api("/api/whatsapp/numbers", { method: "POST", body: { phone } }), "Now send the code below from that phone.");
          if (ok) setPhone("");
        }}
      >
        <label>
          Add a number
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" />
        </label>
        <button className="btn quiet" disabled={!!busy || !phone.trim()}>{busy === "phone" ? "Adding…" : "Get code"}</button>
      </form>

      <Usage usage={usage} />

      <h2>Another company</h2>
      <form
        className="row form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy("org");
          setError("");
          try {
            const { org } = await api("/api/orgs", { method: "POST", body: { name: newOrg, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
            switchOrg(org.id);
          } catch (err) {
            setError(err.message);
            setBusy("");
          }
        }}
      >
        <label>
          Start a separate company
          <input value={newOrg} onChange={(e) => setNewOrg(e.target.value)} placeholder="Company name" />
        </label>
        <button className="btn quiet" disabled={!!busy || !newOrg.trim()}>{busy === "org" ? "Creating…" : "Start"}</button>
      </form>
    </section>
  );
}

// AI allowance (what's left today / this hour) and this month's use per feature.
const FEATURE = {
  chat: "Chat", "gap-check": "Gap checks", voice: "Spoken replies", transcribe: "Voice input", live: "Live voice",
  simulate: "Simulations", weekly: "Weekly reviews", draft: "Message drafts", whatsapp: "WhatsApp", "email-sync": "Email to tasks", other: "Other",
};
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const at = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Usage({ usage }) {
  if (!usage || usage.demo) return null;
  const { companyToday, youThisHour } = usage.allowance || {};
  const month = usage.month || [];
  if (!companyToday && !youThisHour && !month.length) return null;
  const meter = (label, m) =>
    m && (
      <div className="meter-row">
        <div className="meter-label">
          <span>{label}</span>
          <span className="muted">{m.used} of {m.limit} · resets {at(m.resetsAt)}</span>
        </div>
        <span className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={m.limit} aria-valuenow={m.used} style={{ "--w": `${Math.min(100, (m.used / m.limit) * 100)}%` }} />
      </div>
    );
  return (
    <>
      <h2>AI usage</h2>
      <div className="card usage">
        {meter("Company today", companyToday)}
        {meter("You this hour", youThisHour)}
        <p className="muted">A chat answer uses 1 unit, a gap check 5, a weekly review 3.</p>
        {month.length > 0 && (
          <ul className="list compact">
            {month.map((r) => (
              <li key={r.feature} className="history">
                <span className="item-title">{FEATURE[r.feature] || r.feature}</span>
                <span className="muted">{r.calls} AI calls · {fmt(r.tokens)} tokens this month</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
