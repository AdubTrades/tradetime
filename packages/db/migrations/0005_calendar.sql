CREATE TABLE `calendar_event` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`type_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`link` text,
	`date` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`start_time` text,
	`end_time` text,
	`recurrence` text,
	`reminder_minutes` integer,
	`is_task` integer DEFAULT false NOT NULL,
	`done_at` text,
	FOREIGN KEY (`type_id`) REFERENCES `calendar_event_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_event_date_idx` ON `calendar_event` (`date`);--> statement-breakpoint
CREATE TABLE `calendar_event_exception` (
	`event_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`skipped` integer DEFAULT false NOT NULL,
	`override` text,
	`done_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_event`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_exception_idx` ON `calendar_event_exception` (`event_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `calendar_event_type` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`session_type_id` text,
	`is_no_trade` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_type_id`) REFERENCES `session_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `market_event` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`title` text NOT NULL,
	`at` text NOT NULL,
	`impact` text NOT NULL,
	`country` text NOT NULL,
	`currency` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_event_provider_idx` ON `market_event` (`provider`,`provider_id`);--> statement-breakpoint
CREATE INDEX `market_event_at_idx` ON `market_event` (`at`);--> statement-breakpoint
INSERT INTO `calendar_event_type` (`id`, `name`, `color`, `session_type_id`, `is_no_trade`, `sort_order`) VALUES
  ('cet_trading', 'Trading schedule', '#2563eb', 'st_trading', 0, 0),
  ('cet_backtest', 'Backtesting / review', '#0891b2', 'st_backtesting', 0, 1),
  ('cet_no_trade', 'No-trade day', '#9ca3af', NULL, 1, 2),
  ('cet_education', 'Education / live stream', '#ca8a04', 'st_education', 0, 3),
  ('cet_admin', 'Admin and deadlines', '#db2777', NULL, 0, 4),
  ('cet_general', 'General', '#64748b', NULL, 0, 5);
