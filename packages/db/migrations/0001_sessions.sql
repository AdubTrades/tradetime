CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`type_id` text NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`trading_day` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	`edited_at` text,
	FOREIGN KEY (`type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_trading_day_idx` ON `session` (`trading_day`);--> statement-breakpoint
CREATE INDEX `session_start_idx` ON `session` (`start`);--> statement-breakpoint
CREATE TABLE `session_type` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`is_trading` integer DEFAULT false NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_one_running_idx` ON `session` ((1)) WHERE `end` IS NULL AND `deleted_at` IS NULL;
--> statement-breakpoint
INSERT INTO `session_type` (`id`, `name`, `is_trading`, `color`, `sort_order`) VALUES
  ('st_trading', 'Trading', 1, '#2563eb', 0),
  ('st_daily_review', 'Daily review', 0, '#7c3aed', 1),
  ('st_weekly_review', 'Weekly review', 0, '#9333ea', 2),
  ('st_backtesting', 'Backtesting', 0, '#0891b2', 3),
  ('st_education', 'Education', 0, '#ca8a04', 4),
  ('st_other', 'Other', 0, '#64748b', 5);
