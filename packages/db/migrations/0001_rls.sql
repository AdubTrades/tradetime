-- Row-level security: the app works as role tradetime_app, scoped to one user per transaction.
-- Each request does: BEGIN; SET LOCAL ROLE tradetime_app; SELECT set_config('app.user_id', <id>, true); ...
-- Policies then hide other users' rows and reject writes for anyone else. Tables live in the "tradetime"
-- schema, which Supabase's public API doesn't expose; RLS is enabled everywhere as a second guard.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradetime_app') THEN
    CREATE ROLE tradetime_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint
GRANT tradetime_app TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA tradetime TO tradetime_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tradetime TO tradetime_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA tradetime GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tradetime_app;--> statement-breakpoint
ALTER TABLE "tradetime"."user_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_profile_own_rows" ON "tradetime"."user_profile" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."setting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "setting_own_rows" ON "tradetime"."setting" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attachment_own_rows" ON "tradetime"."attachment" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."attachment_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attachment_link_own_rows" ON "tradetime"."attachment_link" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_own_rows" ON "tradetime"."audit_log" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."session_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "session_type_own_rows" ON "tradetime"."session_type" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "session_own_rows" ON "tradetime"."session" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."list_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "list_item_own_rows" ON "tradetime"."list_item" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."firm" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "firm_own_rows" ON "tradetime"."firm" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_own_rows" ON "tradetime"."account" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."recurring_expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "recurring_expense_own_rows" ON "tradetime"."recurring_expense" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "expense_own_rows" ON "tradetime"."expense" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."payout" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payout_own_rows" ON "tradetime"."payout" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."contract" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "contract_own_rows" ON "tradetime"."contract" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."account_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_group_own_rows" ON "tradetime"."account_group" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."account_group_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_group_member_own_rows" ON "tradetime"."account_group_member" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."play" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "play_own_rows" ON "tradetime"."play" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."play_criterion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "play_criterion_own_rows" ON "tradetime"."play_criterion" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."play_example" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "play_example_own_rows" ON "tradetime"."play_example" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."trade" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "trade_own_rows" ON "tradetime"."trade" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."trade_criterion_check" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "trade_criterion_check_own_rows" ON "tradetime"."trade_criterion_check" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."trade_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "trade_tag_own_rows" ON "tradetime"."trade_tag" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."trade_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "trade_account_own_rows" ON "tradetime"."trade_account" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."fill" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fill_own_rows" ON "tradetime"."fill" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."daily_review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "daily_review_own_rows" ON "tradetime"."daily_review" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."question" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "question_own_rows" ON "tradetime"."question" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."state_reading" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "state_reading_own_rows" ON "tradetime"."state_reading" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "calendar_event_type_own_rows" ON "tradetime"."calendar_event_type" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "calendar_event_own_rows" ON "tradetime"."calendar_event" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event_exception" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "calendar_event_exception_own_rows" ON "tradetime"."calendar_event_exception" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."account_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_alias_own_rows" ON "tradetime"."account_alias" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
-- Shared tables (economic events, app status): not anyone's data; the server reads and refreshes them from any request.
ALTER TABLE "tradetime"."market_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "market_event_shared" ON "tradetime"."market_event" FOR ALL TO tradetime_app USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "tradetime"."app_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "app_state_shared" ON "tradetime"."app_state" FOR ALL TO tradetime_app USING (true) WITH CHECK (true);--> statement-breakpoint
-- A user_id must always be set: outside a user transaction the setting can read as '' rather than erroring.
ALTER TABLE "tradetime"."user_profile" ADD CONSTRAINT "user_profile_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."setting" ADD CONSTRAINT "setting_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."attachment" ADD CONSTRAINT "attachment_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."attachment_link" ADD CONSTRAINT "attachment_link_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."audit_log" ADD CONSTRAINT "audit_log_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."session_type" ADD CONSTRAINT "session_type_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."session" ADD CONSTRAINT "session_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."list_item" ADD CONSTRAINT "list_item_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."firm" ADD CONSTRAINT "firm_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."account" ADD CONSTRAINT "account_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ADD CONSTRAINT "expense_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."payout" ADD CONSTRAINT "payout_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."contract" ADD CONSTRAINT "contract_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."account_group" ADD CONSTRAINT "account_group_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."account_group_member" ADD CONSTRAINT "account_group_member_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."play" ADD CONSTRAINT "play_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."play_criterion" ADD CONSTRAINT "play_criterion_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."play_example" ADD CONSTRAINT "play_example_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."trade" ADD CONSTRAINT "trade_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."trade_criterion_check" ADD CONSTRAINT "trade_criterion_check_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."trade_tag" ADD CONSTRAINT "trade_tag_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."trade_account" ADD CONSTRAINT "trade_account_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."fill" ADD CONSTRAINT "fill_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."daily_review" ADD CONSTRAINT "daily_review_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."question" ADD CONSTRAINT "question_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."state_reading" ADD CONSTRAINT "state_reading_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event_type" ADD CONSTRAINT "calendar_event_type_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event" ADD CONSTRAINT "calendar_event_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event_exception" ADD CONSTRAINT "calendar_event_exception_user_id_set" CHECK ("user_id" <> '');--> statement-breakpoint
ALTER TABLE "tradetime"."account_alias" ADD CONSTRAINT "account_alias_user_id_set" CHECK ("user_id" <> '');
