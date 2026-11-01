-- TradeTime backtesting: price history in a private bucket that only the owner can read.
-- Paste into the Supabase SQL Editor once. The files are written by `pnpm --filter @tc/server market-data … --upload`
-- with the secret key (which bypasses these policies), and the app reads them through short-lived signed links made
-- with the owner's own sign-in. Keep the user id below in step with BACKTEST_OWNER_IDS on Vercel.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-data', 'market-data', false, 10485760, array['application/gzip'])
on conflict (id) do nothing;

drop policy if exists "tradetime_market_data_read_owner" on storage.objects;
create policy "tradetime_market_data_read_owner" on storage.objects for select to authenticated
  using (bucket_id = 'market-data' and (select auth.uid()::text) in ('28e55ac6-c54a-4749-90db-9f0e81c4c47c'));
