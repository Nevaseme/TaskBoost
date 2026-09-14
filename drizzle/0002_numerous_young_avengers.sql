CREATE TABLE `assignment_files` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_files_storage_key_unique` ON `assignment_files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `files_assignment` ON `assignment_files` (`assignment_id`);