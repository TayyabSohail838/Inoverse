-- Multi-tenancy: many companies in one Inoverse, each sees only its own data.
-- Run AFTER schema.sql and people.sql (and seed.sql if you use it), in the Supabase SQL Editor.
-- Safe to run more than once.
--
-- What it does:
--   1. Adds organizations, memberships (who belongs to which company), invites and
--      linked WhatsApp numbers.
--   2. Gives every data table an org_id and moves existing rows (company = 'inovix')
--      into a matching organization, so nothing is lost.
--   3. Turns on Row Level Security policies: a signed-in user can only read and write
--      rows of the companies they belong to. Google sign-ins and WhatsApp numbers are
--      only reachable by the server (service key), never by the browser.

create extension if not exists pgcrypto;

-- ---------- 1. organizations, members, invites ----------
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,                 -- old company key ('inovix') for migrated data
  name        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists memberships (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'member')),
  email       text not null default '',    -- copied at join time, so teammates can see who is in
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user on memberships (user_id);

create table if not exists org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        text not null default 'member' check (role in ('owner', 'member')),
  invited_by  uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists org_invites_org_email on org_invites (org_id, lower(email));

-- WhatsApp: which phone belongs to which company. A number only counts once it is
-- verified (the person texts "link <code>" to the Inovo number from that phone).
create table if not exists whatsapp_numbers (
  phone        text primary key,            -- digits with country code, e.g. 923001234567
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  code         text,                        -- 6-digit link code while not verified
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists whatsapp_numbers_org on whatsapp_numbers (org_id);

-- ---------- helpers used by the policies ----------
create or replace function public.is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = o and user_id = auth.uid());
$$;

create or replace function public.is_owner(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = o and user_id = auth.uid() and role = 'owner');
$$;

-- New company: creates it, makes you its owner, and starts its company profile.
create or replace function public.create_organization(org_name text) returns organizations
language plpgsql security definer set search_path = public as $$
declare
  o organizations;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if coalesce(trim(org_name), '') = '' then raise exception 'Give the company a name.'; end if;
  insert into organizations (name, created_by) values (left(trim(org_name), 200), uid) returning * into o;
  insert into memberships (org_id, user_id, role, email)
    values (o.id, uid, 'owner', coalesce(auth.jwt() ->> 'email', ''));
  insert into company_profile (org_id, name, about) values (o.id, o.name, '');
  return o;
end;
$$;

-- Join every company that invited your (confirmed) email address. Returns how many.
create or replace function public.accept_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  mail text;
  n integer := 0;
  inv org_invites;
begin
  if uid is null then return 0; end if;
  -- only a confirmed address can claim an invite, so nobody can sign up with your email and walk in
  select lower(email) into mail from auth.users where id = uid and email_confirmed_at is not null;
  if mail is null then return 0; end if;
  for inv in select * from org_invites where lower(email) = mail and accepted_at is null loop
    insert into memberships (org_id, user_id, role, email) values (inv.org_id, uid, inv.role, mail)
      on conflict (org_id, user_id) do nothing;
    update org_invites set accepted_at = now() where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.create_organization(text) from public, anon;
revoke execute on function public.accept_invites() from public, anon;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.accept_invites() to authenticated;

-- ---------- 2. org_id on every data table, existing rows moved over ----------
do $$
declare
  t text;
  tables text[] := array['company_profile', 'team_members', 'products', 'evidence', 'commitments', 'messages',
                         'gap_checks', 'experiments', 'weekly_reviews', 'tasks', 'integrations', 'contacts', 'whatsapp_log'];
begin
  -- one organization per old company key found in the data (normally just 'inovix')
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'insert into organizations (slug, name)
           select distinct x.company, coalesce((select p.name from company_profile p where p.company = x.company limit 1), x.company)
           from %I x
           where x.company is not null and not exists (select 1 from organizations o where o.slug = x.company)
         on conflict (slug) do nothing', t);
    end if;
  end loop;

  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I add column if not exists org_id uuid references organizations(id) on delete cascade', t);
      execute format('update %I x set org_id = o.id from organizations o where x.org_id is null and o.slug = x.company', t);
    end if;
  end loop;
end $$;

-- primary keys and unique keys that used the old company column
alter table company_profile drop constraint if exists company_profile_pkey;
alter table company_profile alter column org_id set not null;
alter table company_profile add primary key (org_id);

alter table integrations drop constraint if exists integrations_pkey;
alter table integrations alter column org_id set not null;
alter table integrations add primary key (org_id, provider);

drop index if exists tasks_company_source_id;
create unique index if not exists tasks_org_source_id on tasks (org_id, source_id) where source_id is not null;

-- every row must belong to a company; the old text column stays for reference only
do $$
declare
  t text;
  tables text[] := array['company_profile', 'team_members', 'products', 'evidence', 'commitments', 'messages',
                         'gap_checks', 'experiments', 'weekly_reviews', 'tasks', 'integrations', 'contacts', 'whatsapp_log'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I alter column org_id set not null', t);
      execute format('alter table %I alter column company drop not null', t);
      execute format('alter table %I alter column company drop default', t);
    end if;
  end loop;
end $$;

create index if not exists team_members_org on team_members (org_id, created_at);
create index if not exists products_org on products (org_id, created_at);
create index if not exists evidence_org_created on evidence (org_id, created_at desc);
create index if not exists commitments_org on commitments (org_id, created_at);
create index if not exists messages_org_created on messages (org_id, created_at desc);
create index if not exists gap_checks_org_created on gap_checks (org_id, created_at desc);
create index if not exists experiments_org_created on experiments (org_id, created_at desc);
create index if not exists weekly_reviews_org_created on weekly_reviews (org_id, created_at desc);
create index if not exists tasks_org_due on tasks (org_id, status, due_at);
create index if not exists contacts_org_followup on contacts (org_id, next_followup_at);
create index if not exists whatsapp_log_org_created on whatsapp_log (org_id, created_at desc);

-- ---------- 3. Row Level Security ----------
alter table organizations    enable row level security;
alter table memberships      enable row level security;
alter table org_invites      enable row level security;
alter table whatsapp_numbers enable row level security;  -- no policies: server only

drop policy if exists org_read on organizations;
create policy org_read on organizations for select to authenticated using (is_member(id));
drop policy if exists org_rename on organizations;
create policy org_rename on organizations for update to authenticated using (is_owner(id)) with check (is_owner(id));

drop policy if exists members_read on memberships;
create policy members_read on memberships for select to authenticated using (is_member(org_id));
-- owners can remove anyone; anyone can leave
drop policy if exists members_remove on memberships;
create policy members_remove on memberships for delete to authenticated using (is_owner(org_id) or user_id = auth.uid());

drop policy if exists invites_read on org_invites;
create policy invites_read on org_invites for select to authenticated using (is_member(org_id));
drop policy if exists invites_add on org_invites;
create policy invites_add on org_invites for insert to authenticated with check (is_owner(org_id));
drop policy if exists invites_remove on org_invites;
create policy invites_remove on org_invites for delete to authenticated using (is_owner(org_id));

-- company data: members of the company can read and write it, nobody else
do $$
declare
  t text;
  tables text[] := array['company_profile', 'team_members', 'products', 'evidence', 'commitments', 'messages',
                         'gap_checks', 'experiments', 'weekly_reviews', 'tasks', 'contacts', 'whatsapp_log'];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists org_members on %I', t);
      execute format('create policy org_members on %I for all to authenticated using (is_member(org_id)) with check (is_member(org_id))', t);
    end if;
  end loop;
end $$;

-- integrations (Google refresh tokens) deliberately has NO policy: only the server's
-- service key can read it, so a teammate can't pull the owner's Google sign-in from the browser.
alter table integrations enable row level security;
drop policy if exists org_members on integrations;
