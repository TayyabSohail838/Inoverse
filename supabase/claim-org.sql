-- Give yourself your existing company after running multitenant.sql.
-- Your old data (company = 'inovix') now lives in an organization with slug 'inovix',
-- but nobody belongs to it yet. This invites your email as its owner.
--
-- 1. Change the email on the select line below to the one you will sign in with.
-- 2. Run this in the Supabase SQL Editor.
-- 3. Sign in to Inoverse with that email (Google, or email + confirmed password).
--    You join the company automatically on sign-in.

insert into org_invites (org_id, email, role)
select id, lower('you@example.com'), 'owner'
from organizations
where slug = 'inovix'
on conflict do nothing;
