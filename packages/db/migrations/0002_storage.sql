-- File storage bucket and policies, only on Supabase (PGlite and plain Postgres have no "storage" schema).
-- Same statements as packages/db/supabase/storage.sql. If the database role isn't allowed to change storage
-- policies, this logs a notice instead of failing, and the SQL can be run in the Supabase SQL Editor.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    BEGIN
      EXECUTE $tt$
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

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
      $tt$;
    EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
      RAISE NOTICE 'TradeTime: storage policies not applied (%). Run packages/db/supabase/storage.sql in the Supabase SQL Editor.', SQLERRM;
    END;
  END IF;
END
$outer$;
