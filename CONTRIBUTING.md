# Making a change safely

`main` is what Vercel puts live at https://inoverse-ai.vercel.app, so test a change before it
reaches `main`.

1. **Branch:** `git checkout -b short-name-for-the-change`
2. **Change and test locally:**
   ```bash
   npm test          # about 5 seconds, no database or AI needed
   npm run dev       # try it at http://localhost:3000
   ```
   Added or changed an API route? Wrap it in `route()` (lib/http.js) and run
   `node scripts/security-check.mjs http://localhost:3000` against your local server.
   Changed a table? Put the SQL in `supabase/` (safe to run twice) and add to the tests in `tests/`.
3. **Push the branch:** `git push -u origin short-name-for-the-change`. Vercel makes a preview link for it.
4. **Merge to main** (a pull request, or `git checkout main && git merge --ff-only short-name… && git push`).
   Vercel deploys it in about two minutes.
5. **Check the live site:** open it, sign in, and try what you changed.

## Backups

The only GitHub workflow is the nightly encrypted database backup (see [BACKUPS.md](BACKUPS.md)).
A failed backup emails the repository owner. GitHub pauses scheduled workflows after 60 days
without any commits; if that happens, open **Actions** and turn it back on.

## Tests

| File | Covers |
| --- | --- |
| `tests/rls.test.mjs` | the real SQL files: companies can't see or change each other's data |
| `tests/tenant.test.mjs` | server code always filters by the right company, even under load |
| `tests/usage-sql.test.mjs`, `tests/usage.test.mjs` | AI allowance and rate-limit counters |
| `tests/jobs-sql.test.mjs`, `tests/worker.test.mjs` | background jobs: claiming, steps, retries |
| `tests/security.test.mjs` | encryption, rate limits, request size limits |

Security rules and the secrets checklist are in [SECURITY.md](SECURITY.md).
