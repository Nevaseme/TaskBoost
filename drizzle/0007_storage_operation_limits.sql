CREATE TABLE `storage_operation_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT "storage_operation_count" CHECK("storage_operation_limits"."count">0)
);
