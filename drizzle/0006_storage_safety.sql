ALTER TABLE `storage_budget` ADD `epoch` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE storage_budget SET enabled=0 WHERE id=1;
