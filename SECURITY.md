# Security

How Inoverse keeps each company's data private, and the checklist for running it safely.

## What protects what

| Risk | Protection | Where |
| --- | --- | --- |
| One company reading another's data | Every table has `org_id` and database rules (RLS) that only show rows of companies you belong to. Every API route checks your sign-in and company first. | `supabase/multitenant.sql`, `lib/auth.js`, `lib/http.js` |
| A leaked database exposing people's Gmail | Google sign-in keys are encrypted (AES-256-GCM) before they're saved. The key lives only in Vercel's settings. | `lib/secretbox.js`, `lib/tasks.js` |
| Repeating an action very fast (guessing, spam) | Limits on saves (120 a minute per person), new companies (5 an hour), invites (30 an hour), WhatsApp numbers (10 an hour), Google connections (10 per 10 minutes) and WhatsApp link codes (5 tries per 15 minutes per phone; codes expire after 15 minutes). AI use has its own allowance. | `lib/ratelimit.js`, `lib/usage.js` |
| Huge requests tying up the server | Request bodies are capped at 1 MB (voice recordings at 4 MB); text fields are cut to sensible lengths. | `lib/http.js` |
| Other sites framing or scripting Inoverse | Security headers: Content-Security-Policy, X-Frame-Options, HSTS, nosniff, Referrer-Policy, Permissions-Policy (microphone only from Inoverse). | `next.config.mjs` |
| Fake calls to the webhooks and worker | WhatsApp messages must carry Meta's signature; the worker needs the jobs secret; the Google return step needs a signed, expiring state. | `app/api/whatsapp`, `lib/jobs.js`, `lib/signed.js` |
| Internal errors leaking details | Database errors are logged on the server and shown to users as a short "try again". | `lib/http.js` |

## Checking the routes

`scripts/security-check.mjs` finds every API route and tries it the way an attacker would:

```bash
node scripts/security-check.mjs http://localhost:3000
TEST_EMAIL=you@example.com node scripts/security-check.mjs http://localhost:3000   # also tries a company you're not in
```

1. **Not signed in:** every route must refuse, except the few public on purpose (listed in the script).
2. **Signed in, wrong company:** every company route must refuse with 403. Nothing is changed: requests are refused before the route's code runs.

Run it after adding a route. A route that forgets its lock fails the check.

## Secrets checklist

Keep every value below only in Vercel → Settings → Environment Variables and in your own `.env.local`
(which git ignores). Never paste them in chats, screenshots or issues. Mark them **Sensitive** in Vercel.

| Setting | What it protects | If it leaks |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access | Supabase → Project Settings → API Keys → create a new secret key, update Vercel and `.env.local`, delete the old key. |
| `ENCRYPTION_KEY` | The saved Google sign-in keys | Put the old value in `ENCRYPTION_KEY_OLD` and a new one in `ENCRYPTION_KEY`; keys are re-encrypted as they're used. |
| `GOOGLE_CLIENT_SECRET` | Connecting Gmail | Google Cloud → Google Auth Platform → Clients → your client → Add secret, update Vercel and `.env.local`, then disable the old secret. |
| `JOBS_SECRET` | Starting the background worker | Set a new value in Vercel, redeploy, and run `supabase/schedule-jobs.sql` again with it. |
| `GEMINI_API_KEY` | Your AI quota | Google AI Studio → API keys → delete it and create a new one. |
| `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET` | Sending as your WhatsApp number | Meta for Developers → reset the app secret and token. |
| `CRON_SECRET`, `APP_SECRET` | The morning brief cron; signing the Google connect step | Set new long random values in Vercel. |

Make a long random value with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Supabase settings

In the Supabase dashboard → **Authentication**:

- **Sign In / Providers → Email:** keep **Confirm email** on (invites only work for confirmed emails).
- **Sign In / Providers → Email:** set the minimum password length to at least 8 and require letters and digits.
- **Rate Limits:** the defaults are fine; lower "sign-ups and sign-ins" if you see abuse.
- **Attack Protection:** turn on **leaked password protection** if your plan has it.

## Reporting a problem

Email inovixco@gmail.com. Please don't open a public issue for security problems.
