CREATE TABLE `account_alias` (
	`alias` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `fill` ADD `external_id` text;--> statement-breakpoint
CREATE INDEX `fill_external_idx` ON `fill` (`external_id`);--> statement-breakpoint
ALTER TABLE `trade` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade` ADD `needs_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `fill_external_unique_idx` ON `fill` (`external_id`) WHERE `external_id` IS NOT NULL;
