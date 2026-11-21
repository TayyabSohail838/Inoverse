# Inoverse

**An AI partner you talk to, like Jarvis, with a whole C-suite inside.**

**Live demo:** https://inoverse-ai.vercel.app (public demo with sample data)

Inoverse is the app; **Inovo** is the AI partner that lives in it. You don't fill in forms or write prompts. You press **Talk** and speak to it like a cofounder across the table, in English or Roman Urdu. It listens, thinks, answers out loud and keeps the conversation going. Ask a follow-up, interrupt it, or switch on **Hands-free** and just keep talking.

Behind that one voice is a full executive team: **CEO, CTO, CFO, CMO, COO, HR, CPO, CRO, CISO, Legal, Chief of Staff and Investor**. Each answer comes from the right one ("CFO here…"), and the 3D liquid globe at the centre of the screen takes that executive's colour. It ripples while you talk, moves while it thinks, and pulses while it speaks.

## The problem

Small startups in Pakistan are two or three part-time founders doing every job at once. Nobody checks the pricing, the security, the contract or the marketing plan. Teams build things nobody pays for, quote clients badly and forget follow-ups. Mentors and advisors are expensive and rarely available, and general chatbots don't know your company and agree with whatever you say.

## The solution

Inoverse gives a tiny team a leadership team that knows its context and is always one sentence away.

- **Talk, and the right executive answers.** "How should we price Wattly?" goes to the CFO, "How do we protect patient data?" to the CISO, and "A client wants a website, what's the scope?" to the CTO, who gives a PKR quote.
- **A partner that knows you.** Inovo reads your company, team, products, tasks, meetings, leads and evidence before every answer, so it advises on *your* situation, not in general.
- **A partner that does errands too.** "Open YouTube", "what's in my latest email", "what's on my plate this week": the Chief of Staff handles it.
- **Keeps track of your meetings, events and calls.** Inovo reads your Google Calendar for the week ahead, turns emails like "Inovo: pitch at NIC on Friday 3pm" into tasks, and saves "Meeting with Ahmed Monday 4pm" from a WhatsApp text. It plans your day around them, helps you prepare, reminds you who to follow up with after a call, and sends a morning brief of what's coming up.
- **Gap check before you build.** Five reviewers (Critic, Champion, Analyst, Investigator, Customer) review a new idea in parallel. A verdict is calculated from their scores, and you get the cheapest 48-hour real-world test to prove or kill the idea.
- **Market simulation.** Simulated Pakistani customers react to your products, hear each other over two rounds and may change their minds. Inovo ranks your products and names the one to focus on.
- **Runs the company with you.** Tasks and meetings from Gmail and Google Calendar, a People panel for leads with WhatsApp drafts, a weekly review with owners and next actions, and an evidence log.
- **On your phone.** Text or voice-note Inovo on WhatsApp. It saves meetings as tasks and leads as contacts, and sends a morning brief at 8:00.

## Tech stack

- **Frontend:** Next.js 15, React 19, Three.js (liquid globe, voice-reactive)
- **AI:** Gemma 4 (31B and 26B A4B) as the brain; Gemini for audio (speech-to-text, text-to-speech, Gemini Live)
- **Data:** Supabase (Postgres with Row Level Security; the secret key stays on the server)
- **Integrations:** Gmail and Google Calendar (OAuth), WhatsApp Business Cloud API
- **Hosting:** Vercel, with a public demo mode that shows sample data so visitors never see private data

## How Inoverse uses Gemma

1. **Gemma routes across 16 skills.** Gemma first sees only short skill descriptions and picks the right executive; then that skill's full instructions are loaded from `skills/*.md`. Prompts stay small and fast, and adding a department is adding one markdown file. (The C-suite skills are adapted from [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills), MIT.)
2. **Multi-agent debate.** The gap check runs five Gemma agents in parallel with opposite personalities. The final verdict is calculated in code from their scores, not decided by the model, so it is consistent and can't be talked into a yes.
3. **Grounded, not made up.** The Investigator may only use evidence the founder logged; with thin evidence it must score 5 or lower. Every answer is grounded in the company's real context.
4. **Simulated customers on Gemma.** Modelled on [MiroFish](https://github.com/666ghj/MiroFish), but running entirely on Gemma inside the app: no Python, Docker or extra services.
5. **The right Gemma for each job.** Gemma 4 31B handles deep reasoning (gap check, weekly review, simulation). Gemma 4 26B A4B, a mixture-of-experts model, runs live conversation with minimal thinking so spoken replies come back in seconds.
6. **Gemma stays the brain in real-time voice.** Gemini Live handles the fast back-and-forth speech. When you ask for a quote, a simulation, your emails or a gap check, it calls the `inovo_brain` tool, which runs the Gemma route and shows the full answer on screen.
7. **Built for a public link.** If Gemma is busy or out of quota, Inovo moves through backup models with their own free quotas (`gemini-3.5-flash-lite`, then `gemini-2.5-flash-lite`), so several people can talk to it at once without timeouts.
8. **Made for Pakistan.** Roman Urdu voice, prices in PKR, WhatsApp first, and real local customers: clinics, textile mills, schools.

---

## Setup (about 15 minutes)

You need **Node.js 20 or newer** and **Chrome or Edge**.

```bash
npm install
cp .env.example .env.local
```

### 1. Configure Gemma (required)

1. Go to **https://aistudio.google.com** and sign in with a Google account.
2. Click **Get API key** → **Create API key**. Copy it.
3. In `.env.local`, set:
   ```
   GEMINI_API_KEY=your-key
   ```
4. The default model is `gemma-4-31b-it`. If answers are slow or you hit rate limits, add:
   ```
   GEMMA_MODEL=gemma-4-26b-a4b-it
   ```
   If the main model is down on Google's side, the app moves on to backups by itself: `gemma-4-26b-a4b-it`, then `gemini-3.5-flash-lite` (`GEMMA_FALLBACK_MODEL`, a comma-separated list, or `off`).
5. Voice input (the Talk button) is transcribed with `gemini-3.5-flash` on the same key, because Gemma 4 31B cannot take audio. To change it, set `TRANSCRIBE_MODEL`.
   Everyday conversation uses the quicker `gemma-4-26b-a4b-it` with minimal thinking so spoken replies come back in seconds (`GEMMA_FAST_MODEL`). The gap check and weekly review use `GEMMA_MODEL`.
6. **Live voice** (the **Live** toggle, on by default): Talk opens a real-time conversation with Gemini Live (`gemini-3.8-live`; set `LIVE_MODEL` to change). Inovo starts answering about a second after you stop talking, instead of ~20 s. Gemma stays the brain for every skill: when you ask for a simulation, your emails, a gap check, a quote, pricing or a website, Live calls the `inovo_brain` tool, which runs the normal Gemma route (`/api/cofounder`) and shows the full answer on screen. Your API key stays on the server; the browser gets a single-use token from `/api/live`. While Inovo talks the mic is paused so it can't hear itself: press **Skip** to cut it short, **End** to finish. Turn Live off for the older record → answer → speak voice; if Live can't start, Talk falls back to it by itself.
6. The cofounder answers out loud with `gemini-3.8-flash-tts` (voice `Charon`). Change with `TTS_MODEL` and `TTS_VOICE`. When you ask by voice, it listens again after answering, so you can keep talking; stay quiet for 10 seconds or press Stop to end.

That's enough to talk to the cofounder. Without Supabase it reads `data/company-context.md` and saves nothing.

### 2. Connect Supabase (to save evidence, tests and reviews)

1. Go to **https://supabase.com** → **New project**. Pick a name, a database password, and the region nearest to you. Wait for it to finish setting up.
2. Open **SQL Editor** → **New query**. Paste all of `supabase/schema.sql` and click **Run**. You should see "Success. No rows returned".
3. New query again. Paste `supabase/seed.sql` and click **Run**. This adds Inovix's details, you as the first team member, and your five products.
4. Paste `supabase/people.sql` and click **Run** (tasks, People, Google and WhatsApp tables).
5. Paste `supabase/multitenant.sql` and click **Run**. This adds accounts and companies: each company sees only its own data. Your existing data (from `seed.sql`) moves into a company called `inovix`. Run `seed.sql` *before* this file, not after.
6. Paste `supabase/usage.sql` and click **Run**. It adds AI usage limits and tracking (see "AI usage" below).
   Then `supabase/jobs.sql` (background jobs), and once your app is deployed, `supabase/schedule-jobs.sql`
   with your app URL and jobs secret filled in (see "Background jobs" below).
7. Open `supabase/claim-org.sql`, put **your** email on the select line, and **Run** it. That invites you as the owner of the `inovix` company; you join it the first time you sign in.
8. Open **Project Settings** → **API** (or **API Keys**). Copy:
   - the **Project URL** → `SUPABASE_URL`
   - the **service_role** key (on newer dashboards, the **secret** key) → `SUPABASE_SERVICE_ROLE_KEY`
   - the **anon** / **publishable** key → `SUPABASE_ANON_KEY`
9. Add all three to `.env.local`.
10. **Authentication → URL Configuration**: set **Site URL** to `http://localhost:3000` (your Vercel URL once deployed) and add `http://localhost:3000/**` and `https://<your-vercel-domain>/**` under **Redirect URLs**.
11. **Authentication → Providers → Email**: keep **Confirm email** on. Invites are claimed by email address, so only a confirmed address may claim one.
12. Optional, "Continue with Google": **Authentication → Providers → Google** → on, with a Google OAuth client ID and secret. In Google Cloud, add `https://<project-id>.supabase.co/auth/v1/callback` as an authorised redirect URI of that client. The button appears by itself once it's on.

**Keys and privacy.** The service role key can read and write everything. It stays on the server and is never sent to the browser. Never commit `.env.local` or paste this key into the frontend. The anon key is public by design: the browser signs in with it, and the database's Row Level Security policies (in `multitenant.sql`) only let a signed-in person reach the companies they belong to. Google sign-ins and WhatsApp numbers have no policy at all, so only the server can read them.

**Accounts and companies.** People sign in with email + password, an emailed link, or Google. A new person starts a company (they become its owner) or is invited to one: **Company → Access → Invite by email**. Owners invite and remove people; anyone can leave. One person can belong to several companies and switch between them in Company → Access.

### 3. Run it

```bash
npm run dev
```

Open **http://localhost:3000**, sign in in the panel on the right, and allow the microphone. If something is missing, a notice says exactly what to fix. Once everything is configured, the notice disappears.

Open the **Company** tab and add your teammate (name and role). The cofounder assigns tasks only to people listed there.

### 4. Upgrading an older install

Already ran `schema.sql` and `people.sql` before? Run `supabase/multitenant.sql`, then `supabase/claim-org.sql` with your email (steps 5–6 above), add `SUPABASE_ANON_KEY`, and restart. Nothing is deleted: every row is moved into the `inovix` company.

### 5. Connect Google: Gmail + Calendar (optional, about 15 minutes)

- **Gmail:** Inovo reads **only** emails whose subject starts with **Inovo**, for example `Inovo: pitch at NIC on Friday 3pm`, and turns them into tasks.
- **Calendar:** Inovo reads your meetings for the next 7 days (read-only), plans around them and helps you prepare.

1. Go to **https://console.cloud.google.com** → create a project called **INOVERSE**.
2. **APIs & Services** → **Library** → enable **Gmail API** and **Google Calendar API**.
3. **Google Auth Platform** (or **OAuth consent screen**) → **Get started**: app name **INOVERSE**, your email as support email, audience **External**. Under **Audience** → **Test users**, add your Gmail address.
4. **Clients** (or **Credentials** → **Create credentials** → **OAuth client ID**) → type **Web application**. Under **Authorized redirect URIs** add `http://localhost:3000/api/google/callback` and `https://<your-vercel-domain>/api/google/callback`.
5. Copy the **Client ID** and **Client secret** into `.env.local` (and Vercel):
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
   Restart `npm run dev`.
6. Open the **Tasks** panel → **Connect Gmail** → sign in and tick **both** Gmail and Calendar. Google warns that the app isn't verified; click **Continue**. It's your own app.

Inoverse checks for new Inovo emails when it opens and every 5 minutes. While the Google app is in **Testing** mode, Google ends the sign-in after 7 days; the Tasks panel then asks you to connect again.

### 6. People & outreach (no setup)

Open **People** in the dock. Add leads, clients and partners with their WhatsApp number, stage and follow-up date. Inovo knows who is due, **Draft message** writes a short WhatsApp message, and **Open in WhatsApp** opens the chat with it typed. Numbers starting with 0 get Pakistan's code (92); change it with `DEFAULT_COUNTRY_CODE`.

### 6b. Market simulation (no setup)

Open **Simulate** in the dock (Inovo switches to its CMO role). Modelled on the [MiroFish](https://github.com/666ghj/MiroFish) startup-simulation method, but runs on Gemma inside the app: no Python, Docker or Zep account needed.

- **Compare products:** every product meets 8 simulated Pakistani customers. Score = 50% their demand + 30% how fast a small team can land the first paying customer + 20% product readiness. Inovo names the product to focus on, the fastest cash and one action for this week.
- **Simulate one:** seed brief → 6 personas → round 1 (each reacts alone) → round 2 (they hear each other and may change their mind) → report: segments, objections, trust barriers, price, search words, skeptical/base/optimistic cases, 5 hypotheses to test with real people and a 48-hour test. Scenarios: Launch, Pricing, Message.
- Or just ask: **"Which of our products is best?"**, **"Simulate Wattly"**, **"konsa product best hai?"**
- The briefs live in `data/product-briefs.md` (prices there are assumptions; edit them). Evidence you log for a product is added automatically.
- These are AI-made customers: use the result to pick what to test with real people, not as proof of demand.

### 7. Connect WhatsApp: text Inovo from your phone (optional, about 30 minutes)

Text Inovo like a person: *"Meeting with Ahmed from Al-Noor clinic Monday 4pm, he wants a quote"* → Inovo replies, saves the meeting as a task and Ahmed in People. Voice notes work. Send **brief** for today's plan. Every morning at 8:00 (Pakistan time) Inovo sends each company's linked numbers their brief.

This uses Meta's official WhatsApp Business Cloud API. It needs the **Vercel link** (Meta must reach a public address) and a phone number that isn't already on WhatsApp (Meta gives you a free test number to start).

1. Go to **https://developers.facebook.com** → **My Apps** → **Create app** → type **Business** → name it **INOVERSE** → add the **WhatsApp** product.
2. **WhatsApp → API Setup**: note the **Phone number ID**. Under **To**, add **your own** WhatsApp number and confirm the code.
3. Make a permanent token: **business.facebook.com → Settings → System users** → add a system user (Admin) → **Add assets** → your app (full control) → **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. **App settings → Basic**: copy the **App secret**.
5. In Vercel → **Environment Variables** add:
   ```
   WHATSAPP_TOKEN=the system user token
   WHATSAPP_PHONE_NUMBER_ID=from API Setup
   WHATSAPP_APP_SECRET=from App settings → Basic
   WHATSAPP_VERIFY_TOKEN=any password you make up
   WHATSAPP_DISPLAY_NUMBER=+1 555 0100  (optional: Inovo's number, shown in the app when linking)
   CRON_SECRET=another long random password (for the morning brief)
   ```
   Redeploy.
6. **WhatsApp → Configuration → Webhook → Edit**: callback URL `https://<your-vercel-domain>/api/whatsapp`, verify token = your `WHATSAPP_VERIFY_TOKEN` → **Verify and save**. Then **Manage** → subscribe to **messages**.
7. Link your phone to your company: in the app open **Company → Access → WhatsApp**, add your number, and text the code it shows (`link 123456`) to Inovo from that phone. Each teammate links their own number the same way. Only linked numbers get answers, and each number belongs to one company, so Inovo always answers with the right company's data.
8. Text Inovo: "hi Inovo".

(`WHATSAPP_OWNER_NUMBER` from older setups still works for the `inovix` company without linking.)

**The morning brief and WhatsApp's 24-hour rule:** WhatsApp lets Inovo send you normal messages only within 24 hours of your last message to it. Text it once a day and the brief always arrives. To get it even when you haven't, create a template in **WhatsApp Manager → Message templates** (category **Utility**, body `{{1}}`), wait for approval, and set `WHATSAPP_BRIEF_TEMPLATE=<template name>` (and `WHATSAPP_BRIEF_TEMPLATE_LANG` if it isn't `en`).

### 8. Deploy (optional)

1. Push the project to GitHub and import it in **Vercel**.
2. In Vercel → **Settings** → **Environment Variables**, add `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `APP_SECRET` (any long random string; it signs the Google connect step) and `ENCRYPTION_KEY` (another long random string; it encrypts saved Google sign-in keys). See [SECURITY.md](SECURITY.md) for the full checklist.
3. Decide what the link is for. On Vercel the app runs as the **public demo** by default (sample data, nothing saved, no sign-in). To let real companies sign up and use it, set `DEMO_MODE=off`. Then everyone signs in and sees only their own company.
4. Add your Vercel URL to Supabase → Authentication → URL Configuration (step 2.10).

### AI usage: limits and tracking

All companies share one `GEMINI_API_KEY`, so each one gets an allowance, counted in units:
a chat answer, a spoken reply or a voice input is 1 unit, Live voice 2, a weekly review 3, a gap check 5.

| Setting | Default | Means |
| --- | --- | --- |
| `AI_LIMIT_USER_HOUR` | 60 | Units one signed-in person can use per hour |
| `AI_LIMIT_ORG_DAY` | 400 | Units one company can use per day (resets at midnight UTC) |
| `AI_LIMIT_IP_HOUR` | 30 | Units per visitor per hour on the public demo |

Set any of them to `off` to remove that limit. When a limit is reached, Inovo says when it resets
instead of failing. Each company sees its allowance and this month's use in **Company → Access → AI usage**.

Every AI call is stored in `ai_usage` (company, person, feature, model, tokens, time). To see what each
company used this month, run this in the Supabase SQL Editor:

```sql
select o.name, u.feature, count(*) as calls, sum(u.input_tokens + u.output_tokens) as tokens
from ai_usage u join organizations o on o.id = u.org_id
where u.created_at >= date_trunc('month', now()) and not u.demo
group by 1, 2 order by 4 desc;
```

### Background jobs

Slow or scheduled work runs in the background, in small steps, so nothing hits Vercel's 60-second limit:

| Job | When | Steps |
| --- | --- | --- |
| Gap check | When you ask for one | Brief → five reviewers (in parallel) → verdict and write-up. Inovo answers at once; the chat shows progress and then the verdict. |
| Morning brief | 8:00 in each company's time zone (Company → Access) | One job per company, so one failure never stops the rest. |
| WhatsApp reply | Each incoming message | One job per message. |

A failed step is retried after 30 s and then 60 s; after 3 tries the job is marked `failed` with the
reason. Finished jobs are kept for a week in the `jobs` table.

The worker is `/api/jobs/run`. It starts right after a job is added, and every minute from Supabase
(`schedule-jobs.sql`, which uses the `pg_cron` and `pg_net` extensions). Vercel Cron also starts it
once a day as a fallback. Calls must carry the jobs secret: `JOBS_SECRET` if you set one, otherwise a
value derived from your service key. To see recent jobs:

```sql
select kind, status, error, attempts, created_at from jobs order by created_at desc limit 20;
```

Without `jobs.sql`, everything still works the old way (inside the request).

Which models are busy or out of quota is shared through `ai_model_status`, so every server copy skips
them straight away. If `usage.sql` hasn't been run, nothing breaks: limits and tracking are simply off.

---

### Security

Each company's data is separated by database rules and checked on every request; saved Google
sign-in keys are encrypted; repeated actions are rate-limited; and security headers stop other sites
from framing or scripting Inoverse. [SECURITY.md](SECURITY.md) has the details, the secrets checklist
and the Supabase settings to turn on. After adding an API route, run:

```bash
node scripts/security-check.mjs http://localhost:3000
```

It tries every route without signing in (and, with `TEST_EMAIL` set, as a member of the wrong company) and fails if any route lets it through.

## Test it

1. Type **"How should we price Wattly?"** → a pricing answer in PKR, read aloud.
2. Click **Talk** and say **"I want to build a fabric defect app for small mills. Check the gaps first."** → the weave tightens while thinking (up to 40 seconds), then a verdict card appears, the reviewers move by score, and the weave takes the verdict's colour.
3. Open **Tests** → the 48-hour test from that gap check is waiting. Set it to Passed or Failed, add notes, save → it also appears in **Evidence**.
4. Open **Evidence** → add a real customer conversation. Run the gap check again; the Investigator now uses it.
5. Open **Weekly review** → add a commitment, write a short update for each person, run the review → health score, one goal and tasks, read aloud.
6. Say **"Open YouTube"** or **"WhatsApp kholo"** → a new tab opens. If Chrome blocks it, use the button in the chat or allow pop-ups for the site once.
7. Switch to **اردو** and ask something → it listens in Urdu and answers in Roman Urdu.
8. Reload the page → the conversation is still there.
9. Open **Simulate** → **Find our best product** → a ranked list of the Inovix products with what simulated customers said. **Full simulation** runs the two-round version for one product.

**Automated tests:** `npm test` runs the checks for company separation, AI limits, background jobs
and security in about 5 seconds, with no database or AI calls. GitHub runs them (and a production build) on every
push, watches the live site every 30 minutes, and backs up the database nightly. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [BACKUPS.md](BACKUPS.md).

---

## How it works

```
Browser: 3D weave + voice + panel
   │  mic recording            POST /api/speak (Gemini TTS: text → voice)
   ├─ POST /api/transcribe (Gemini 3.5 Flash: speech → text)
   ▼
POST /api/cofounder
   ├─ website command? ──► open a tab (no AI)
   ├─ Gemma router picks a skill
   │     ├─ everyday skill ──► 1 Gemma call with company context
   │     └─ gap check ───────► brief → 5 reviewers in parallel → verdict in code
   │                            → 48-hour test → Judge → saved + test created
   └─ conversation saved
Company context = Supabase (profile, team, products, commitments, open tests, evidence)
                  or data/company-context.md when Supabase isn't connected
```

Logging a test result as passed or failed files it as evidence, so each gap check learns from the last real test.

## API

All routes return JSON. With Supabase set up, send the signed-in user's Supabase access token as `Authorization: Bearer <token>` and the open company as `x-org-id` (optional; defaults to the user's first company). Without a database, `ACCESS_CODE` (if set) goes in the `x-access-code` header.

| Route | Does |
| --- | --- |
| `POST /api/cofounder` | Talk: `{ message, history?, lang? }` → `{ skill, say, details, gapCheck?, experimentId?, action? }` |
| `GET /api/messages` | Last 30 messages, oldest first |
| `GET, POST /api/evidence` · `DELETE /api/evidence/:id` | Evidence the Investigator uses |
| `GET /api/experiments` · `PATCH /api/experiments/:id` | 48-hour tests and gap-check history; passed/failed results become evidence |
| `GET, POST /api/commitments` · `PATCH, DELETE /api/commitments/:id` | Commitments for the weekly review |
| `GET, POST /api/weekly-review` | Run a review (health score computed in code) and list past ones |
| `GET, PUT /api/company` | Company name and description, team, products |
| `POST /api/team` · `DELETE /api/team/:id` | Team members |
| `POST /api/products` · `PATCH, DELETE /api/products/:id` | Products and their stage |
| `GET /api/status` | What's configured (never returns secrets) |
| `GET /api/me` | The signed-in user, their companies and the open one |
| `POST /api/orgs` | Start a company: `{ name }` (you become its owner) |
| `GET, POST /api/orgs/access` · `DELETE /api/orgs/access/:id` | Members and invites; owners invite (`{ email, role }`) and remove; `?kind=invite` cancels an invite |
| `GET /api/jobs/:id` | A background job's status and stage, and its result when done (the company's own jobs only) |
| `POST /api/jobs/run` | Starts the worker (needs the jobs secret) |
| `PATCH /api/orgs` | Set the company's time zone: `{ timezone }` (owners) |
| `GET /api/usage` | This company's AI allowance and this month's use per feature |
| `GET, POST, DELETE /api/whatsapp/numbers` | WhatsApp numbers linked to the company; POST gives the `link <code>` to text |

## Files

| Path | Purpose |
| --- | --- |
| `components/Loom3D.jsx` | The woven 3D core and the five orbiting reviewers (three.js, custom shaders) |
| `components/CofounderApp.jsx` | Voice, microphone level, chat, verdict card, tabs |
| `components/Panels.jsx` | Evidence, Tests, Weekly review, Company tabs |
| `app/globals.css` | Colours and type (Bricolage Grotesque) |
| `app/api/**` | The routes above |
| `lib/gemma.js` | Gemma client |
| `lib/skills.js`, `skills/*.md` | Skill router and the four skills |
| `lib/gapCheck.js` | The five-reviewer gap check |
| `lib/verdict.js`, `lib/cheapestTest.js`, `lib/commitmentHealth.js` | Scoring in plain code |
| `lib/openIntent.js` | Website and search commands |
| `lib/db.js`, `lib/store.js`, `lib/context.js` | Supabase access and the company context |
| `lib/tenant.js`, `lib/auth.js` | Which company a request is for, from the signed-in user |
| `lib/orgs.js`, `lib/phones.js`, `lib/signed.js` | Members and invites, linked WhatsApp numbers, signed values |
| `lib/session.js`, `components/AuthPanel.jsx`, `components/AccessSection.jsx` | Sign-in in the browser, the sign-in drawer, Company → Access |
| `supabase/schema.sql`, `supabase/seed.sql` | Database tables and starting data |
| `lib/jobs.js`, `lib/worker.js`, `lib/jobKinds.js`, `supabase/jobs.sql`, `supabase/schedule-jobs.sql` | Background jobs: queue, worker, job steps and the schedule |
| `lib/usage.js`, `supabase/usage.sql` | AI allowance, usage tracking, shared model status |
| `supabase/multitenant.sql`, `supabase/claim-org.sql` | Companies, members and Row Level Security; claiming the migrated company |

## Known limits

- Voice input needs a browser that can record audio (Chrome, Edge, Firefox, Safari). Typing works everywhere.
- Few computers have an Urdu voice, so Roman Urdu is read by an English voice.
- The Investigator has no web search; it uses only the Evidence tab.
- A gap check makes 8 Gemma calls and takes 15–40 seconds.
- A product comparison makes about 7 Gemma calls and takes 30–60 seconds (longer on a slow connection; results are reused for 30 minutes). A full simulation of one product makes 4 calls. Each step is its own request, so it fits Vercel's 60-second limit.
- Website commands open browser tabs only, not desktop apps or files.
- `data/company-context.md` and `data/product-briefs.md` describe Inovix and are only used for the `inovix` company and when there's no database.

## Credits

- Skills adapted from [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) (MIT, see `LICENSE-claude-skills-MIT.txt`): roast, weekly-review, pricing-strategist, solo-founder persona. Rewritten for Gemma and Pakistan; scoring ported from Python to JavaScript.
- Skill format: the Agent Skills standard ([anthropics/skills](https://github.com/anthropics/skills)).
- 3D: [three.js](https://threejs.org) (MIT). Font: Bricolage Grotesque (SIL Open Font License).
- The voice interface, 3D design, API and gap-check pipeline are original. No code from FatihMakes' Mark assistants is used (CC BY-NC, non-commercial only).
