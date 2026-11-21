"use client";
// Sign in, and start (or wait to join) a company. Shown in the right-hand drawer, so the
// globe stays in view: DESIGN.md "Corners for information, centre for presence".
//   mode "signin" → email + password, an emailed link, or Google (if enabled in Supabase)
//   mode "org"    → signed in but in no company yet: name a new one, or get invited
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { authClient, authConfig, authRedirect, setOrgId, signOut } from "@/lib/session";

export default function AuthPanel({ mode, email, onDone }) {
  return mode === "org" ? <NewCompany email={email} onDone={onDone} /> : <SignIn />;
}

function SignIn() {
  const [view, setView] = useState("signin"); // signin | signup
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [google, setGoogle] = useState(false);
  const sb = authClient();

  // show "Continue with Google" only when it's switched on in Supabase
  useEffect(() => {
    const cfg = authConfig();
    if (!cfg) return;
    fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.anonKey } })
      .then((r) => r.json())
      .then((s) => setGoogle(Boolean(s?.external?.google)))
      .catch(() => {});
  }, []);

  async function run(fn) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await fn();
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const creds = { email: form.email.trim(), password: form.password };
      if (view === "signup") {
        const { data, error } = await sb.auth.signUp({ ...creds, options: { emailRedirectTo: authRedirect() } });
        if (error) throw error;
        // with email confirmation on, there's no session until they click the link
        if (!data.session) setNote(`Check ${creds.email} for a confirmation link, then come back here.`);
      } else {
        const { error } = await sb.auth.signInWithPassword(creds);
        if (error) throw error;
      }
    });
  };

  const emailLink = () =>
    run(async () => {
      const mail = form.email.trim();
      if (!mail) throw new Error("Type your email first.");
      const { error } = await sb.auth.signInWithOtp({ email: mail, options: { emailRedirectTo: authRedirect() } });
      if (error) throw error;
      setNote(`Sign-in link sent to ${mail}. Open it on this device.`);
    });

  const withGoogle = () =>
    run(async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: authRedirect() } });
      if (error) throw error;
    });

  if (!sb) return <p className="lead">Sign-in isn't set up yet. See the setup note on the left.</p>;

  return (
    <div className="stack auth">
      <p className="lead">
        Each company's tasks, people, evidence and chats are private to the people in it. Sign in to open yours.
      </p>

      <div className="seg" role="tablist" aria-label="Sign in or create an account">
        <button role="tab" aria-selected={view === "signin"} onClick={() => setView("signin")}>Sign in</button>
        <button role="tab" aria-selected={view === "signup"} onClick={() => setView("signup")}>Create account</button>
      </div>

      {(error || note) && (
        <p className={`flash ${error ? "error" : "ok"}`} role={error ? "alert" : "status"}>
          {error || note}
        </p>
      )}

      <form className="card form" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={view === "signup" ? "new-password" : "current-password"}
            minLength={view === "signup" ? 8 : undefined}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>
        <button className="btn" disabled={busy || !form.email.trim() || !form.password}>
          {busy ? "One moment…" : view === "signup" ? "Create account" : "Sign in"}
        </button>
        <button type="button" className="link" onClick={emailLink} disabled={busy}>
          Email me a sign-in link instead
        </button>
      </form>

      {google && (
        <>
          <p className="auth-or" aria-hidden="true">or</p>
          <button className="btn quiet" onClick={withGoogle} disabled={busy}>Continue with Google</button>
        </>
      )}
    </div>
  );
}

function NewCompany({ email, onDone }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { org } = await api("/api/orgs", { method: "POST", body: { name } });
      setOrgId(org.id);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack auth">
      <p className="lead">
        You're signed in as <b>{email}</b>. Start your company, and Inovo will learn it from the Company tab.
      </p>
      {error && <p className="flash error" role="alert">{error}</p>}
      <form className="card form" onSubmit={create}>
        <label>
          Company name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inovix & Co" autoFocus />
        </label>
        <button className="btn" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Start company"}</button>
      </form>

      <h2>Joining a team?</h2>
      <p className="muted">
        Ask an owner to invite <b>{email}</b> from Company → Access. Then check again; you join as soon as the invite exists.
      </p>
      <div className="row">
        <button className="btn quiet" onClick={onDone}>Check again</button>
        <button className="link" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

// Supabase's messages, in plain words.
function friendly(msg = "") {
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Try again, or use a sign-in link.";
  if (/email not confirmed/i.test(msg)) return "Confirm your email first: open the link we sent you.";
  if (/already registered/i.test(msg)) return "There's already an account with that email. Sign in instead.";
  if (/rate limit|too many/i.test(msg)) return "Too many emails sent for now. Wait a few minutes, then try again.";
  if (/password should be/i.test(msg)) return "Use a longer password (at least 8 characters).";
  return msg || "Something went wrong. Try again.";
}
