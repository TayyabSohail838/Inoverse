// Tries every API route the way an attacker would, and fails if any of them lets it through.
//
//   node scripts/security-check.mjs [base url]          (default http://localhost:3000)
//
// 1. Not signed in        → every route must refuse (401), except the few that are public
//                           on purpose or carry their own proof (listed in PUBLIC below).
// 2. Signed in, but asking for a company you're not in (random x-org-id)
//                         → every company route must refuse (403).
//    Step 2 runs when TEST_EMAIL is set: it signs that existing user in with a one-time link
//    made with SUPABASE_SERVICE_ROLE_KEY (read from .env.local). Nothing is created or changed:
//    every request is refused before it reaches the route's code.
//
// Routes are found by reading app/api, so a new route is checked automatically.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Routes that answer without sign-in on purpose, and what they must answer instead.
const PUBLIC = {
  "GET /api/status": [200], // tells the app whether sign-in is set up; no company data
  "GET /api/google/callback": [302, 303, 307, 308], // Google's return: needs a signed state, else sends you home with an error
  "GET /api/whatsapp": [403, 503], // Meta's webhook check: needs the verify token
  "POST /api/whatsapp": [401, 503], // Meta's messages: needs Meta's signature
  "GET /api/jobs/run": [401, 503], // the worker: needs the jobs secret
  "POST /api/jobs/run": [401, 503],
  "GET /api/whatsapp/brief": [401], // Vercel Cron's morning brief: needs CRON_SECRET
};
// Signed-in routes that work before you have a company (so step 2 doesn't apply).
const NO_ORG = new Set(["GET /api/me", "POST /api/orgs"]);

function env() {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")])
    );
  } catch {
    return {};
  }
}

function routes() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.js") {
        const src = fs.readFileSync(p, "utf8");
        const url = "/" + path.relative(path.join(ROOT, "app"), path.dirname(p)).split(path.sep).join("/").replace(/\[[^\]]+\]/g, randomUUID());
        for (const m of src.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) out.push({ method: m[1], url, file: path.relative(ROOT, p) });
      }
    }
  };
  walk(path.join(ROOT, "app", "api"));
  return out;
}

const key = (r) => `${r.method} ${r.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "[id]")}`;

async function call(r, headers = {}) {
  const res = await fetch(BASE + r.url, {
    method: r.method,
    redirect: "manual",
    headers: { "content-type": "application/json", ...headers },
    body: r.method === "GET" ? undefined : "{}",
  });
  return res.status;
}

async function signIn(email, e) {
  const url = e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL;
  const service = e.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) throw new Error("TEST_EMAIL needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const h = { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json" };
  const link = await (await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: h, body: JSON.stringify({ type: "magiclink", email }) })).json();
  const hashed = link.hashed_token || link.properties?.hashed_token;
  if (!hashed) throw new Error(`Couldn't make a sign-in link for ${email}: ${JSON.stringify(link).slice(0, 160)}`);
  const s = await (await fetch(`${url}/auth/v1/verify`, { method: "POST", headers: h, body: JSON.stringify({ type: "magiclink", token_hash: hashed }) })).json();
  if (!s.access_token) throw new Error(`Sign-in failed: ${JSON.stringify(s).slice(0, 160)}`);
  return s.access_token;
}

const list = routes();
let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`  ✗ ${msg}`);
};

console.log(`Checking ${list.length} route handlers on ${BASE}\n\n1. Not signed in`);
for (const r of list) {
  const k = key(r);
  const status = await call(r);
  const want = PUBLIC[k] || [401];
  if (!want.includes(status)) fail(`${k} answered ${status}, expected ${want.join(" or ")}  (${r.file})`);
}
const extra = Object.keys(PUBLIC).filter((k) => !list.some((r) => key(r) === k));
if (extra.length) console.log(`  (public list mentions routes that no longer exist: ${extra.join(", ")})`);
console.log(failed ? "" : "  ✓ every route refused or behaved as a public route should");

const e = env();
const email = process.env.TEST_EMAIL;
if (!email) {
  console.log("\n2. Wrong company: skipped (set TEST_EMAIL to an existing user to run it)");
} else {
  console.log(`\n2. Signed in as ${email}, asking for a company they're not in`);
  const token = await signIn(email, e);
  const before = failed;
  for (const r of list) {
    const k = key(r);
    if (PUBLIC[k] || NO_ORG.has(k)) continue;
    const status = await call(r, { authorization: `Bearer ${token}`, "x-org-id": randomUUID() });
    if (status !== 403) fail(`${k} answered ${status}, expected 403  (${r.file})`);
  }
  console.log(failed === before ? "  ✓ every company route refused" : "");
}

console.log(failed ? `\n${failed} problem(s) found.` : "\nAll good.");
process.exit(failed ? 1 : 0);
