# Backups

Every night at 02:30 (Pakistan time), GitHub Actions makes a backup of the Supabase database
(`.github/workflows/backup.yml`):

- **What:** every app table in the `public` schema (companies, members, tasks, people, evidence,
  chats, …) and the sign-in accounts (`auth.users`).
- **Encrypted** with `BACKUP_PASSPHRASE` before it's stored, because this repository is public.
  Without the passphrase a backup can't be opened, so keep a copy of it somewhere safe.
- **Kept 30 days:** GitHub → **Actions** → **Database backup** → a run → **Artifacts**.
- To make one right now: **Actions** → **Database backup** → **Run workflow**.

## Setting it up (once)

In GitHub → the repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

1. `SUPABASE_DB_URL`: in Supabase, click **Connect** (top of the dashboard), choose **Session pooler**,
   copy the connection string and replace `[YOUR-PASSWORD]` with your database password.
   (Forgot it? Supabase → Project Settings → Database → Reset database password.)
   Use the *Session pooler* string: GitHub's servers can't reach the direct connection.
2. `BACKUP_PASSPHRASE`: a long random password. Save it in your password manager too.

Then run the workflow once by hand and check it ends with a green ✅ and an artifact.

## Restoring

Restore into a **new, empty Supabase project first** and check the data there. Only restore
over the live database if you're sure; it replaces what's there.

You need `gpg` and the Postgres 17 tools (`pg_restore`). On Windows, Git Bash includes `gpg`;
or run everything inside Docker with the `postgres:17` image.

```bash
# 1. Download the artifact from the Actions run and unzip it, then decrypt and unpack:
gpg --decrypt inoverse-db-2026-11-22.tar.gz.gpg > backup.tar.gz     # asks for BACKUP_PASSPHRASE
tar -xzf backup.tar.gz                                                # → backup/public-….dump, backup/auth-users-….dump

# 2. The connection string of the project you're restoring into (Supabase → Connect → Session pooler):
export DB="postgresql://postgres.xxxx:PASSWORD@aws-0-….pooler.supabase.com:5432/postgres"

# 3. Sign-in accounts first (tables refer to them), then the app's tables and data:
pg_restore --no-owner --no-privileges --data-only --disable-triggers -d "$DB" backup/auth-users-*.dump
pg_restore --no-owner --no-privileges --clean --if-exists -d "$DB" backup/public-*.dump
```

Restoring a single table (e.g. tasks deleted by mistake) into the live database:

```bash
pg_restore --no-owner --no-privileges --data-only --table=tasks -d "$DB" backup/public-*.dump
```

After a restore into a new project, point the app at it: update `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` in Vercel and `.env.local`, and run
`supabase/schedule-jobs.sql` there. Saved Google connections only open with the same
`ENCRYPTION_KEY`; if that key is lost, people simply reconnect Gmail.
