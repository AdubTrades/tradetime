CREATE TABLE `question` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`prompt` text NOT NULL,
	`kind` text NOT NULL,
	`applies_to` text DEFAULT 'both' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `state_reading` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`answers` text NOT NULL,
	`decision` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `state_reading_session_idx` ON `state_reading` (`session_id`);--> statement-breakpoint
CREATE INDEX `state_reading_at_idx` ON `state_reading` (`at`);--> statement-breakpoint
ALTER TABLE `trade` ADD `state_reading_id` text;--> statement-breakpoint
ALTER TABLE `trade` ADD `state_overridden` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `question` (`id`, `prompt`, `kind`, `applies_to`, `sort_order`) VALUES
  ('q_mood', 'How are you feeling?', 'mood', 'both', 0),
  ('q_focus', 'Focus', 'scale', 'both', 1),
  ('q_energy', 'Energy', 'scale', 'both', 2),
  ('q_plan', 'Following my plan?', 'yesPartlyNo', 'both', 3),
  ('q_day_plan', 'Plan for the session', 'text', 'start', 4),
  ('q_levels', 'Key levels and events', 'text', 'start', 5),
  ('q_changed', 'What changed?', 'text', 'checkin', 6);
