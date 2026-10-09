CREATE TABLE "tradetime"."feedback" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"kind" text DEFAULT 'general' NOT NULL,
	"message" text NOT NULL,
	"page" text,
	"user_agent" text,
	"app_version" text,
	CONSTRAINT "feedback_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "tradetime"."feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "feedback_own_rows" ON "tradetime"."feedback" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."feedback" ADD CONSTRAINT "feedback_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
-- Account deletion: signed-in users may delete files in their own folder (only used by "Delete my account").
-- Supabase only; same as the delete policy in packages/db/supabase/storage.sql.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    BEGIN
      EXECUTE $tt$
drop policy if exists "tradetime_attachments_delete_own" on storage.objects;
create policy "tradetime_attachments_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));
      $tt$;
    EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
      RAISE NOTICE 'TradeTime: storage delete policy not applied (%). Run packages/db/supabase/storage.sql in the Supabase SQL Editor.', SQLERRM;
    END;
  END IF;
END
$outer$;
