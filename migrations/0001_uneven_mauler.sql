ALTER TABLE `registrants` ADD `attendance_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `registrants` ADD `attended_minutes` integer;--> statement-breakpoint
ALTER TABLE `zoom_events` ADD `duration_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `zoom_events` ADD `attendance_synced_at` integer;