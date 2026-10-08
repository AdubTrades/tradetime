-- TradeTime file storage on Supabase: a private bucket with one folder per user.
-- Applied automatically by migration 0002 when the app's database is Supabase. While the app still uses a local
-- database (sign-in only on Supabase), paste this into the Supabase SQL Editor once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

-- Signed-in users can read, add and replace files only in the folder named after their own user id.
drop policy if exists "tradetime_attachments_read_own" on storage.objects;
create policy "tradetime_attachments_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "tradetime_attachments_insert_own" on storage.objects;
create policy "tradetime_attachments_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "tradetime_attachments_update_own" on storage.objects;
create policy "tradetime_attachments_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));
-- No delete policy: files are kept (records are soft-deleted). Account deletion removes them with the secret key.
