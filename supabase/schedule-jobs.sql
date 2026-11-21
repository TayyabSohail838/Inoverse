-- Starts the background worker: every minute, Supabase calls your app's /api/jobs/run.
-- Run AFTER jobs.sql, once, in the Supabase SQL Editor. Running it again replaces the schedule.
--
-- Fill in two values below:
--   APP_URL     your live address, e.g. https://inoverse-ai.vercel.app
--   JOBS_SECRET the value of JOBS_SECRET in Vercel. If you haven't set one, Claude can
--               compute the default for you (it's derived from your service key);
--               never commit the filled-in file.
--
-- Uses two Supabase extensions: pg_cron (the schedule) and pg_net (the web call).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('inoverse-jobs') where exists (select 1 from cron.job where jobname = 'inoverse-jobs');

select cron.schedule(
  'inoverse-jobs',
  '* * * * *',
  $$
  select net.http_post(
    url := 'APP_URL/api/jobs/run?tick=1',
    headers := jsonb_build_object('content-type', 'application/json', 'x-jobs-secret', 'JOBS_SECRET'),
    body := '{}'::jsonb
  );
  $$
);
