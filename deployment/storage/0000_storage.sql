CREATE TABLE `storage_budget` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`reserved_bytes` integer DEFAULT 0 NOT NULL,
	`day` text NOT NULL,
	`writes_today` integer DEFAULT 0 NOT NULL,
	`reads_today` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "storage_singleton" CHECK("storage_budget"."id"=1),
	CONSTRAINT "storage_enabled" CHECK("storage_budget"."enabled" IN (0,1)),
	CONSTRAINT "storage_nonnegative_bytes" CHECK("storage_budget"."reserved_bytes">=0),
	CONSTRAINT "storage_nonnegative_writes" CHECK("storage_budget"."writes_today">=0),
	CONSTRAINT "storage_nonnegative_reads" CHECK("storage_budget"."reads_today">=0)
);
--> statement-breakpoint
CREATE TABLE `storage_reservations` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "storage_file_bytes" CHECK("storage_reservations"."bytes">0 AND "storage_reservations"."bytes"<=20971520)
);

--> statement-breakpoint
INSERT INTO storage_budget(id,reserved_bytes,day)
SELECT 1,COALESCE(SUM(bytes),0),strftime('%Y-%m-%d','now') FROM storage_reservations;
--> statement-breakpoint
CREATE TRIGGER storage_reserve_before BEFORE INSERT ON storage_reservations BEGIN
  SELECT RAISE(ABORT, 'STORAGE_LIMIT') WHERE NOT EXISTS (
    SELECT 1 FROM storage_budget WHERE id=1 AND enabled=1
      AND reserved_bytes + NEW.bytes <= 5000000000
      AND day <= strftime('%Y-%m-%d','now')
      AND (day < strftime('%Y-%m-%d','now') OR writes_today < 300)
  );
END;
--> statement-breakpoint
CREATE TRIGGER storage_reserve_after AFTER INSERT ON storage_reservations BEGIN
  UPDATE storage_budget SET reserved_bytes=reserved_bytes+NEW.bytes,
    writes_today=writes_today*(day=strftime('%Y-%m-%d','now'))+1,
    reads_today=reads_today*(day=strftime('%Y-%m-%d','now')),
    day=strftime('%Y-%m-%d','now') WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER storage_release AFTER DELETE ON storage_reservations BEGIN
  UPDATE storage_budget SET reserved_bytes=reserved_bytes-OLD.bytes WHERE id=1;
END;

--> statement-breakpoint
ALTER TABLE `storage_budget` ADD `epoch` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE storage_budget SET enabled=0 WHERE id=1;

--> statement-breakpoint
CREATE TABLE `storage_operation_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	CONSTRAINT "storage_operation_count" CHECK("storage_operation_limits"."count">0)
);
