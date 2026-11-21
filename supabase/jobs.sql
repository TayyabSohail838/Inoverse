-- Background jobs: slow or scheduled work (gap checks, morning briefs, Gmail checks,
-- WhatsApp replies) runs in small steps outside the user's request, with retries.
-- Run AFTER multitenant.sql, in the Supabase SQL Editor. Safe to run more than once.
-- Then run schedule-jobs.sql once to start the every-minute worker.
--
-- Only the server (service key) can touch these. Nothing here is reachable from the browser.

create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references organizations(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  kind          text not null,                 -- gap-check, brief, gmail-sync, whatsapp-message
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  input         jsonb not null default '{}',
  state         jsonb not null default '{}',   -- progress between steps
  result        jsonb,
  error         text,
  attempts      integer not null default 0,    -- tries of the current step (reset when a step succeeds)
  max_attempts  integer not null default 3,
  run_at        timestamptz not null default now(),
  locked_until  timestamptz,
  dedupe_key    text unique,                   -- e.g. brief:<company>:<date>, so a job is only added once
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists jobs_due on jobs (status, run_at);
create index if not exists jobs_org_created on jobs (org_id, created_at desc);

alter table jobs enable row level security;  -- no policies: server only

-- Each company's time zone, so its morning brief arrives at 8:00 where it is.
alter table organizations add column if not exists timezone text not null default 'Asia/Karachi';

-- Hand up to p_limit due jobs to one worker. A job whose worker died (lease ran out)
-- becomes due again. SKIP LOCKED lets several workers run at once without taking the
-- same job. Counts the try, so a step that keeps crashing is stopped after max_attempts.
create or replace function public.claim_jobs(p_limit integer, p_lease_secs integer)
returns setof jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  update jobs j
     set status = 'running',
         locked_until = now() + make_interval(secs => p_lease_secs),
         attempts = j.attempts + 1,
         updated_at = now()
   where j.id in (
     select id from jobs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_until < now())
      order by run_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke execute on function public.claim_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer, integer) to service_role;
