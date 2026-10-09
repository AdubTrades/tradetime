-- TradeTime scheduled jobs on Supabase: call the app's tick endpoint every minute.
-- Run once in the Supabase SQL Editor AFTER the app is deployed (Phase 8), replacing the two placeholders:
--   <APP_URL>      your app's address, e.g. https://tradetime.vercel.app
--   <JOBS_SECRET>  the same random secret as the server's JOBS_SECRET (make one with: openssl rand -hex 32)
-- The URL and secret are kept in Supabase Vault (encrypted), not in the job text. Safe to run again (e.g. to change
-- the address or secret): existing Vault entries are updated and the job is replaced.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  url_id uuid;
  secret_id uuid;
begin
  select id into url_id from vault.secrets where name = 'tradetime_jobs_url';
  if url_id is null then
    perform vault.create_secret('<APP_URL>/api/jobs/tick', 'tradetime_jobs_url', 'TradeTime tick endpoint');
  else
    perform vault.update_secret(url_id, '<APP_URL>/api/jobs/tick');
  end if;

  select id into secret_id from vault.secrets where name = 'tradetime_jobs_secret';
  if secret_id is null then
    perform vault.create_secret('<JOBS_SECRET>', 'tradetime_jobs_secret', 'TradeTime JOBS_SECRET');
  else
    perform vault.update_secret(secret_id, '<JOBS_SECRET>');
  end if;
end $$;

-- Re-running cron.schedule with the same name replaces the job.

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
