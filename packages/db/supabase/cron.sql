-- TradeTime scheduled jobs on Supabase: call the app's tick endpoint every minute.
-- Run once in the Supabase SQL Editor AFTER the app is deployed (Phase 8), replacing the two placeholders:
--   <APP_URL>      your app's address, e.g. https://tradetime.vercel.app
--   <JOBS_SECRET>  the same random secret as the server's JOBS_SECRET (make one with: openssl rand -hex 32)
-- The URL and secret are kept in Supabase Vault (encrypted), not in the job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<APP_URL>/api/jobs/tick', 'tradetime_jobs_url', 'TradeTime tick endpoint');
select vault.create_secret('<JOBS_SECRET>', 'tradetime_jobs_secret', 'TradeTime JOBS_SECRET');

select cron.schedule(
  'tradetime-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tradetime_jobs_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tradetime_jobs_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);

-- Check it's running:   select * from cron.job_run_details order by start_time desc limit 5;
--                       select status_code, content from net._http_response order by created desc limit 5;
-- Stop it:              select cron.unschedule('tradetime-tick');
