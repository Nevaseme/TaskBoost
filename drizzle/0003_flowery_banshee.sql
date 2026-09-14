CREATE TABLE `ai_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`class_id` text NOT NULL,
	`day` text NOT NULL,
	`status` text NOT NULL,
	`elapsed_ms` integer,
	`usage` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_requests_day_class` ON `ai_requests` (`day`,`class_id`);--> statement-breakpoint
CREATE INDEX `ai_requests_day_user` ON `ai_requests` (`day`,`user_id`);--> statement-breakpoint
CREATE TABLE `ai_stops` (
	`day` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assignments` ADD `submission_format` text DEFAULT '' NOT NULL;