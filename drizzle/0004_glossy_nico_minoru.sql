CREATE TABLE `reminder_events` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`reasons` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_once_per_minute` ON `reminder_events` (`assignment_id`,`user_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `reminder_operation` ON `reminder_events` (`operation_id`);--> statement-breakpoint
CREATE TABLE `reminder_settings` (
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`custom_at` text,
	`deadline_enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`assignment_id`, `user_id`),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
