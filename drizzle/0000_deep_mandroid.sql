CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_endpoint_unique` ON `subscriptions` (`endpoint`);