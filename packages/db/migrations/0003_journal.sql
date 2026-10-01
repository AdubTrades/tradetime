CREATE TABLE `account_group` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_group_member` (
	`group_id` text NOT NULL,
	`account_id` text NOT NULL,
	`multiplier` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `account_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_group_member_idx` ON `account_group_member` (`group_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `contract` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`tick_size` real NOT NULL,
	`point_value_cents` integer NOT NULL,
	`fee_per_side_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_review` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`trading_day` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_review_trading_day_unique` ON `daily_review` (`trading_day`);--> statement-breakpoint
CREATE TABLE `fill` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_account_id` text NOT NULL,
	`at` text NOT NULL,
	`side` text NOT NULL,
	`qty` integer NOT NULL,
	`price` real NOT NULL,
	FOREIGN KEY (`trade_account_id`) REFERENCES `trade_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fill_trade_account_idx` ON `fill` (`trade_account_id`);--> statement-breakpoint
CREATE TABLE `play` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`title` text NOT NULL,
	`description` text,
	`grade_rules` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `play_criterion` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`play_id` text NOT NULL,
	`label` text NOT NULL,
	`must_have` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`play_id`) REFERENCES `play`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `play_criterion_play_idx` ON `play_criterion` (`play_id`);--> statement-breakpoint
CREATE TABLE `play_example` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`play_id` text NOT NULL,
	`grade` text NOT NULL,
	`attachment_id` text NOT NULL,
	`caption` text,
	`date` text,
	`result_label` text,
	`source_trade_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`play_id`) REFERENCES `play`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `play_example_play_idx` ON `play_example` (`play_id`);--> statement-breakpoint
CREATE TABLE `trade` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`trading_day` text NOT NULL,
	`contract_id` text NOT NULL,
	`direction` text NOT NULL,
	`play_id` text,
	`grade` text,
	`outside_plan` integer DEFAULT false NOT NULL,
	`stop_price` real,
	`target_price` real,
	`planned_risk_points` real,
	`followed_plan` text,
	`emotion_id` text,
	`confidence` integer,
	`notes` text,
	`session_id` text,
	`opened_at` text NOT NULL,
	`closed_at` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`play_id`) REFERENCES `play`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emotion_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trade_day_idx` ON `trade` (`trading_day`);--> statement-breakpoint
CREATE INDEX `trade_opened_idx` ON `trade` (`opened_at`);--> statement-breakpoint
CREATE TABLE `trade_account` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`account_id` text NOT NULL,
	`multiplier` integer DEFAULT 1 NOT NULL,
	`fees_cents` integer DEFAULT 0 NOT NULL,
	`point_value_cents` integer NOT NULL,
	`tick_size` real NOT NULL,
	`max_qty` integer NOT NULL,
	`avg_entry` real NOT NULL,
	`avg_exit` real NOT NULL,
	`gross_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`planned_risk_cents` integer,
	FOREIGN KEY (`trade_id`) REFERENCES `trade`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trade_account_trade_idx` ON `trade_account` (`trade_id`);--> statement-breakpoint
CREATE INDEX `trade_account_account_idx` ON `trade_account` (`account_id`);--> statement-breakpoint
CREATE TABLE `trade_criterion_check` (
	`trade_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	`label` text NOT NULL,
	`must_have` integer NOT NULL,
	`checked` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trade`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_criterion_check_idx` ON `trade_criterion_check` (`trade_id`,`criterion_id`);--> statement-breakpoint
CREATE TABLE `trade_tag` (
	`trade_id` text NOT NULL,
	`list_item_id` text NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trade`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`list_item_id`) REFERENCES `list_item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_tag_idx` ON `trade_tag` (`trade_id`,`list_item_id`);--> statement-breakpoint
INSERT INTO `contract` (`id`, `symbol`, `name`, `tick_size`, `point_value_cents`, `fee_per_side_cents`, `sort_order`) VALUES
  ('ct_es', 'ES', 'E-mini S&P 500', 0.25, 5000, 0, 0),
  ('ct_nq', 'NQ', 'E-mini Nasdaq-100', 0.25, 2000, 0, 1),
  ('ct_mes', 'MES', 'Micro E-mini S&P 500', 0.25, 500, 0, 2),
  ('ct_mnq', 'MNQ', 'Micro E-mini Nasdaq-100', 0.25, 200, 0, 3);
--> statement-breakpoint
INSERT INTO `list_item` (`id`, `kind`, `name`, `sort_order`) VALUES
  ('li_mood_neutral', 'mood', 'Neutral', 0),
  ('li_mood_focused', 'mood', 'Focused', 1),
  ('li_mood_content', 'mood', 'Content', 2),
  ('li_mood_stressed', 'mood', 'Stressed', 3),
  ('li_mood_frustrated', 'mood', 'Frustrated', 4),
  ('li_mistake_fomo', 'mistake', 'FOMO entry', 0),
  ('li_mistake_chased', 'mistake', 'Chased entry', 1),
  ('li_mistake_moved_stop', 'mistake', 'Moved stop', 2),
  ('li_mistake_early_exit', 'mistake', 'Early exit', 3),
  ('li_mistake_oversized', 'mistake', 'Oversized', 4),
  ('li_mistake_revenge', 'mistake', 'Revenge trade', 5),
  ('li_mistake_overtraded', 'mistake', 'Overtraded', 6);
