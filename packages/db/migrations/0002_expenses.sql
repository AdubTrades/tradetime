CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`firm_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`end_date` text,
	`starting_balance_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	FOREIGN KEY (`firm_id`) REFERENCES `firm`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`vendor` text,
	`date` text NOT NULL,
	`description` text,
	`category_id` text,
	`type_id` text,
	`payment_method_id` text,
	`account_id` text,
	`ex_gst_cents` integer NOT NULL,
	`gst_cents` integer NOT NULL,
	`inc_gst_cents` integer NOT NULL,
	`business_use_pct` integer DEFAULT 100 NOT NULL,
	`recurring_id` text,
	`import_batch_id` text,
	FOREIGN KEY (`category_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_method_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring_expense`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expense_date_idx` ON `expense` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_recurring_date_idx` ON `expense` (`recurring_id`,`date`);--> statement-breakpoint
CREATE TABLE `firm` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`website` text,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_item_kind_name_idx` ON `list_item` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `payout` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`account_id` text,
	`requested_date` text,
	`received_date` text NOT NULL,
	`gross_usd_cents` integer,
	`aud_received_cents` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payout_received_idx` ON `payout` (`received_date`);--> statement-breakpoint
CREATE TABLE `recurring_expense` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`vendor` text,
	`description` text,
	`category_id` text,
	`type_id` text,
	`payment_method_id` text,
	`account_id` text,
	`ex_gst_cents` integer NOT NULL,
	`gst_cents` integer NOT NULL,
	`business_use_pct` integer DEFAULT 100 NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_method_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `list_item` (`id`, `kind`, `name`, `sort_order`) VALUES
  ('li_pm_credit_card', 'payment_method', 'Credit Card', 0),
  ('li_pm_debit_card', 'payment_method', 'Debit Card', 1),
  ('li_pm_bank_transfer', 'payment_method', 'Bank Transfer', 2),
  ('li_type_digital', 'expense_type', 'Digital', 0),
  ('li_type_physical', 'expense_type', 'Physical', 1),
  ('li_type_service', 'expense_type', 'Service', 2);
