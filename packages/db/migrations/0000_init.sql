CREATE SCHEMA "tradetime";
--> statement-breakpoint
CREATE TABLE "tradetime"."account" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"firm_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" text,
	"end_date" text,
	"starting_balance_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	CONSTRAINT "account_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."account_alias" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"alias" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "account_alias_user_id_alias_pk" PRIMARY KEY("user_id","alias")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."account_group" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"name" text NOT NULL,
	CONSTRAINT "account_group_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."account_group_member" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"group_id" text NOT NULL,
	"account_id" text NOT NULL,
	"multiplier" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_group_member_user_id_group_id_account_id_pk" PRIMARY KEY("user_id","group_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tradetime"."attachment" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"original_name" text,
	CONSTRAINT "attachment_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."attachment_link" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"attachment_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"role" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "attachment_link_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."audit_log" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "audit_log_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."calendar_event" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"type_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"link" text,
	"date" text NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"start_time" text,
	"end_time" text,
	"recurrence" jsonb,
	"reminder_minutes" integer,
	"is_task" boolean DEFAULT false NOT NULL,
	"done_at" text,
	CONSTRAINT "calendar_event_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."calendar_event_exception" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"event_id" text NOT NULL,
	"occurrence_date" text NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"override" jsonb,
	"done_at" text,
	CONSTRAINT "calendar_event_exception_user_id_event_id_occurrence_date_pk" PRIMARY KEY("user_id","event_id","occurrence_date")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."calendar_event_type" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"session_type_id" text,
	"is_no_trade" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calendar_event_type_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."contract" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"tick_size" double precision NOT NULL,
	"point_value_cents" integer NOT NULL,
	"fee_per_side_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "contract_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."daily_review" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"trading_day" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "daily_review_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."expense" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"name" text NOT NULL,
	"vendor" text,
	"date" text NOT NULL,
	"description" text,
	"category_id" text,
	"type_id" text,
	"payment_method_id" text,
	"account_id" text,
	"ex_gst_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"inc_gst_cents" integer NOT NULL,
	"business_use_pct" integer DEFAULT 100 NOT NULL,
	"recurring_id" text,
	"import_batch_id" text,
	CONSTRAINT "expense_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."fill" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"trade_account_id" text NOT NULL,
	"at" text NOT NULL,
	"side" text NOT NULL,
	"qty" integer NOT NULL,
	"price" double precision NOT NULL,
	"external_id" text,
	CONSTRAINT "fill_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."firm" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"name" text NOT NULL,
	"website" text,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "firm_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."list_item" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "list_item_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."market_event" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"title" text NOT NULL,
	"at" text NOT NULL,
	"impact" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"fetched_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tradetime"."payout" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"account_id" text,
	"requested_date" text,
	"received_date" text NOT NULL,
	"gross_usd_cents" integer,
	"aud_received_cents" integer NOT NULL,
	"notes" text,
	CONSTRAINT "payout_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."play" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"title" text NOT NULL,
	"description" text,
	"grade_rules" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "play_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."play_criterion" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"play_id" text NOT NULL,
	"label" text NOT NULL,
	"must_have" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "play_criterion_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."play_example" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"play_id" text NOT NULL,
	"grade" text NOT NULL,
	"attachment_id" text NOT NULL,
	"caption" text,
	"date" text,
	"result_label" text,
	"source_trade_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "play_example_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."question" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"prompt" text NOT NULL,
	"kind" text NOT NULL,
	"applies_to" text DEFAULT 'both' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "question_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."recurring_expense" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"name" text NOT NULL,
	"vendor" text,
	"description" text,
	"category_id" text,
	"type_id" text,
	"payment_method_id" text,
	"account_id" text,
	"ex_gst_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"business_use_pct" integer DEFAULT 100 NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recurring_expense_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."session" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"type_id" text NOT NULL,
	"start" text NOT NULL,
	"end" text,
	"trading_day" text NOT NULL,
	"source" text NOT NULL,
	"notes" text,
	"edited_at" text,
	CONSTRAINT "session_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."session_type" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"name" text NOT NULL,
	"is_trading" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "session_type_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."setting" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "setting_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."state_reading" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" text NOT NULL,
	"answers" jsonb NOT NULL,
	"decision" text,
	CONSTRAINT "state_reading_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."trade" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"deleted_at" text,
	"trading_day" text NOT NULL,
	"contract_id" text NOT NULL,
	"direction" text NOT NULL,
	"play_id" text,
	"grade" text,
	"outside_plan" boolean DEFAULT false NOT NULL,
	"stop_price" double precision,
	"target_price" double precision,
	"planned_risk_points" double precision,
	"followed_plan" text,
	"emotion_id" text,
	"confidence" integer,
	"notes" text,
	"session_id" text,
	"state_reading_id" text,
	"state_overridden" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"opened_at" text NOT NULL,
	"closed_at" text NOT NULL,
	CONSTRAINT "trade_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."trade_account" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"trade_id" text NOT NULL,
	"account_id" text NOT NULL,
	"multiplier" integer DEFAULT 1 NOT NULL,
	"fees_cents" integer DEFAULT 0 NOT NULL,
	"point_value_cents" integer NOT NULL,
	"tick_size" double precision NOT NULL,
	"max_qty" integer NOT NULL,
	"avg_entry" double precision NOT NULL,
	"avg_exit" double precision NOT NULL,
	"gross_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"planned_risk_cents" integer,
	CONSTRAINT "trade_account_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."trade_criterion_check" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"trade_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"label" text NOT NULL,
	"must_have" boolean NOT NULL,
	"checked" boolean NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trade_criterion_check_user_id_trade_id_criterion_id_pk" PRIMARY KEY("user_id","trade_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."trade_tag" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"trade_id" text NOT NULL,
	"list_item_id" text NOT NULL,
	CONSTRAINT "trade_tag_user_id_trade_id_list_item_id_pk" PRIMARY KEY("user_id","trade_id","list_item_id")
);
--> statement-breakpoint
CREATE TABLE "tradetime"."user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tradetime"."account" ADD CONSTRAINT "account_user_id_firm_id_firm_user_id_id_fk" FOREIGN KEY ("user_id","firm_id") REFERENCES "tradetime"."firm"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."account_alias" ADD CONSTRAINT "account_alias_user_id_account_id_account_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "tradetime"."account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."account_group_member" ADD CONSTRAINT "account_group_member_user_id_group_id_account_group_user_id_id_fk" FOREIGN KEY ("user_id","group_id") REFERENCES "tradetime"."account_group"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."account_group_member" ADD CONSTRAINT "account_group_member_user_id_account_id_account_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "tradetime"."account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."attachment_link" ADD CONSTRAINT "attachment_link_user_id_attachment_id_attachment_user_id_id_fk" FOREIGN KEY ("user_id","attachment_id") REFERENCES "tradetime"."attachment"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event" ADD CONSTRAINT "calendar_event_user_id_type_id_calendar_event_type_user_id_id_fk" FOREIGN KEY ("user_id","type_id") REFERENCES "tradetime"."calendar_event_type"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event_exception" ADD CONSTRAINT "calendar_event_exception_user_id_event_id_calendar_event_user_id_id_fk" FOREIGN KEY ("user_id","event_id") REFERENCES "tradetime"."calendar_event"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."calendar_event_type" ADD CONSTRAINT "calendar_event_type_user_id_session_type_id_session_type_user_id_id_fk" FOREIGN KEY ("user_id","session_type_id") REFERENCES "tradetime"."session_type"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ADD CONSTRAINT "expense_user_id_category_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ADD CONSTRAINT "expense_user_id_type_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","type_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ADD CONSTRAINT "expense_user_id_payment_method_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","payment_method_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ADD CONSTRAINT "expense_user_id_account_id_account_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "tradetime"."account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."expense" ADD CONSTRAINT "expense_user_id_recurring_id_recurring_expense_user_id_id_fk" FOREIGN KEY ("user_id","recurring_id") REFERENCES "tradetime"."recurring_expense"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."fill" ADD CONSTRAINT "fill_user_id_trade_account_id_trade_account_user_id_id_fk" FOREIGN KEY ("user_id","trade_account_id") REFERENCES "tradetime"."trade_account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."payout" ADD CONSTRAINT "payout_user_id_account_id_account_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "tradetime"."account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."play_criterion" ADD CONSTRAINT "play_criterion_user_id_play_id_play_user_id_id_fk" FOREIGN KEY ("user_id","play_id") REFERENCES "tradetime"."play"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."play_example" ADD CONSTRAINT "play_example_user_id_play_id_play_user_id_id_fk" FOREIGN KEY ("user_id","play_id") REFERENCES "tradetime"."play"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."play_example" ADD CONSTRAINT "play_example_user_id_attachment_id_attachment_user_id_id_fk" FOREIGN KEY ("user_id","attachment_id") REFERENCES "tradetime"."attachment"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_category_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_type_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","type_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_payment_method_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","payment_method_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."recurring_expense" ADD CONSTRAINT "recurring_expense_user_id_account_id_account_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "tradetime"."account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."session" ADD CONSTRAINT "session_user_id_type_id_session_type_user_id_id_fk" FOREIGN KEY ("user_id","type_id") REFERENCES "tradetime"."session_type"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."state_reading" ADD CONSTRAINT "state_reading_user_id_session_id_session_user_id_id_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "tradetime"."session"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade" ADD CONSTRAINT "trade_user_id_contract_id_contract_user_id_id_fk" FOREIGN KEY ("user_id","contract_id") REFERENCES "tradetime"."contract"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade" ADD CONSTRAINT "trade_user_id_play_id_play_user_id_id_fk" FOREIGN KEY ("user_id","play_id") REFERENCES "tradetime"."play"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade" ADD CONSTRAINT "trade_user_id_emotion_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","emotion_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade" ADD CONSTRAINT "trade_user_id_session_id_session_user_id_id_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "tradetime"."session"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade_account" ADD CONSTRAINT "trade_account_user_id_trade_id_trade_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "tradetime"."trade"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade_account" ADD CONSTRAINT "trade_account_user_id_account_id_account_user_id_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "tradetime"."account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade_criterion_check" ADD CONSTRAINT "trade_criterion_check_user_id_trade_id_trade_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "tradetime"."trade"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade_tag" ADD CONSTRAINT "trade_tag_user_id_trade_id_trade_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "tradetime"."trade"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tradetime"."trade_tag" ADD CONSTRAINT "trade_tag_user_id_list_item_id_list_item_user_id_id_fk" FOREIGN KEY ("user_id","list_item_id") REFERENCES "tradetime"."list_item"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_sha256_idx" ON "tradetime"."attachment" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "attachment_link_owner_idx" ON "tradetime"."attachment_link" USING btree ("user_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "tradetime"."audit_log" USING btree ("user_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "calendar_event_date_idx" ON "tradetime"."calendar_event" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_review_trading_day_idx" ON "tradetime"."daily_review" USING btree ("user_id","trading_day");--> statement-breakpoint
CREATE INDEX "expense_date_idx" ON "tradetime"."expense" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_recurring_date_idx" ON "tradetime"."expense" USING btree ("user_id","recurring_id","date");--> statement-breakpoint
CREATE INDEX "fill_trade_account_idx" ON "tradetime"."fill" USING btree ("user_id","trade_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fill_external_unique_idx" ON "tradetime"."fill" USING btree ("user_id","external_id") WHERE "tradetime"."fill"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "list_item_kind_name_idx" ON "tradetime"."list_item" USING btree ("user_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "market_event_provider_idx" ON "tradetime"."market_event" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE INDEX "market_event_at_idx" ON "tradetime"."market_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "payout_received_idx" ON "tradetime"."payout" USING btree ("user_id","received_date");--> statement-breakpoint
CREATE INDEX "play_criterion_play_idx" ON "tradetime"."play_criterion" USING btree ("user_id","play_id");--> statement-breakpoint
CREATE INDEX "play_example_play_idx" ON "tradetime"."play_example" USING btree ("user_id","play_id");--> statement-breakpoint
CREATE INDEX "session_trading_day_idx" ON "tradetime"."session" USING btree ("user_id","trading_day");--> statement-breakpoint
CREATE INDEX "session_start_idx" ON "tradetime"."session" USING btree ("user_id","start");--> statement-breakpoint
CREATE UNIQUE INDEX "session_one_running_idx" ON "tradetime"."session" USING btree ("user_id") WHERE "tradetime"."session"."end" IS NULL AND "tradetime"."session"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "state_reading_session_idx" ON "tradetime"."state_reading" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "state_reading_at_idx" ON "tradetime"."state_reading" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "trade_day_idx" ON "tradetime"."trade" USING btree ("user_id","trading_day");--> statement-breakpoint
CREATE INDEX "trade_opened_idx" ON "tradetime"."trade" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "trade_account_trade_idx" ON "tradetime"."trade_account" USING btree ("user_id","trade_id");--> statement-breakpoint
CREATE INDEX "trade_account_account_idx" ON "tradetime"."trade_account" USING btree ("user_id","account_id");