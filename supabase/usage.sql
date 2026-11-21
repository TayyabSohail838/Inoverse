-- AI usage: limits, tracking and shared model status. Run AFTER multitenant.sql,
-- in the Supabase SQL Editor. Safe to run more than once.
--
--   ai_usage         one row per AI call: company, user, feature, model, tokens, time
--   ai_limits        usage counters per hour / day, so one user or company can't use up
--                    the shared Google quota for everyone
--   ai_model_status  which AI model is busy or out of quota, shared by every server copy
--
-- Only the server (service key) can touch these. Nothing here is reachable from the browser.

create table if not exists ai_usage (
  id             bigint generated always as identity primary key,
  org_id         uuid references organizations(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  feature        text not null default 'other',   -- chat, voice, transcribe, live, gap-check, simulate, weekly, draft, whatsapp, email-sync
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,        -- includes the model's thinking tokens
  ms             integer not null default 0,
  demo           boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_org_created on ai_usage (org_id, created_at desc);
create index if not exists ai_usage_created on ai_usage (created_at desc);

create table if not exists ai_limits (
  key           text not null,          -- u:<user>:h, o:<company>:d, ip:<address>:h
  window_start  timestamptz not null,
  used          integer not null default 0,
  primary key (key, window_start)
);

create table if not exists ai_model_status (
  model       text primary key,
  down_until  timestamptz not null,
  reason      text not null default '',
  updated_at  timestamptz not null default now()
);

alter table ai_usage        enable row level security;  -- no policies: server only
alter table ai_limits       enable row level security;
alter table ai_model_status enable row level security;

-- Spend `p_cost` units against several limits at once (e.g. the user's hour and the
-- company's day). Either every limit has room and all are charged, or nothing is charged
-- and it says which limit is full. Rows are locked, so two requests can't both slip past.
create or replace function public.ai_spend(p_keys text[], p_windows integer[], p_limits integer[], p_cost integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i integer;
  w timestamptz;
  u integer;
begin
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    w := to_timestamp(floor(extract(epoch from now()) / p_windows[i]) * p_windows[i]);
    insert into ai_limits (key, window_start, used) values (p_keys[i], w, 0) on conflict do nothing;
    select used into u from ai_limits where key = p_keys[i] and window_start = w for update;
    if u + p_cost > p_limits[i] then
      return jsonb_build_object('allowed', false, 'key', p_keys[i], 'used', u, 'limit', p_limits[i],
                                'reset_at', w + make_interval(secs => p_windows[i]));
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    w := to_timestamp(floor(extract(epoch from now()) / p_windows[i]) * p_windows[i]);
    update ai_limits set used = used + p_cost where key = p_keys[i] and window_start = w;
  end loop;
  -- now and then, clear out old counters
  if random() < 0.01 then delete from ai_limits where window_start < now() - interval '3 days'; end if;
  return jsonb_build_object('allowed', true);
end;
$$;

-- This company's AI use since a date, per feature (for the Company panel).
create or replace function public.org_ai_usage(p_org uuid, p_since timestamptz)
returns table (feature text, calls bigint, tokens bigint)
language sql stable security definer set search_path = public as $$
  select feature, count(*), coalesce(sum(input_tokens + output_tokens), 0)
  from ai_usage
  where org_id = p_org and created_at >= p_since and not demo
  group by feature
  order by 3 desc;
$$;

revoke execute on function public.ai_spend(text[], integer[], integer[], integer) from public, anon, authenticated;
revoke execute on function public.org_ai_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend(text[], integer[], integer[], integer) to service_role;
grant execute on function public.org_ai_usage(uuid, timestamptz) to service_role;
