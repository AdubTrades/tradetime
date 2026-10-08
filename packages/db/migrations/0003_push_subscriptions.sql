CREATE TABLE "tradetime"."push_subscription" (
	"user_id" text DEFAULT current_setting('app.user_id') NOT NULL,
	"id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_used_at" text,
	CONSTRAINT "push_subscription_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_idx" ON "tradetime"."push_subscription" USING btree ("user_id","endpoint");--> statement-breakpoint
ALTER TABLE "tradetime"."push_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "push_subscription_own_rows" ON "tradetime"."push_subscription" FOR ALL TO tradetime_app USING ("user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "tradetime"."push_subscription" ADD CONSTRAINT "push_subscription_user_id_set" CHECK ("user_id" <> '');
