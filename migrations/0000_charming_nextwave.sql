CREATE TABLE `ghl_custom_fields` (
	`location_id` text NOT NULL,
	`field_key` text NOT NULL,
	`ghl_field_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`location_id`, `field_key`)
);
--> statement-breakpoint
CREATE TABLE `registrants` (
	`id` text PRIMARY KEY NOT NULL,
	`registration_route_id` text NOT NULL,
	`zoom_event_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`ghl_contact_id` text,
	`zoom_registrant_id` text,
	`join_url` text,
	`short_join_code` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`registration_route_id`) REFERENCES `registration_routes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zoom_event_id`) REFERENCES `zoom_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `registration_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`type` text NOT NULL,
	`selection_mode` text NOT NULL,
	`series_id` text,
	`specific_zoom_event_id` text,
	`ghl_workflow_id` text NOT NULL,
	`ghl_location_id` text NOT NULL,
	`field_mapping_json` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`specific_zoom_event_id`) REFERENCES `zoom_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_routes_slug_unique` ON `registration_routes` (`slug`);--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`series_id` text NOT NULL,
	`template_id` text NOT NULL,
	`recurrence_rule_json` text,
	`lead_time_days` integer DEFAULT 0 NOT NULL,
	`run_at_utc` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`evergreen_short_code` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_slug_unique` ON `series` (`slug`);--> statement-breakpoint
CREATE TABLE `short_links` (
	`code` text PRIMARY KEY NOT NULL,
	`target_url` text NOT NULL,
	`kind` text NOT NULL,
	`series_id` text,
	`registrant_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registrant_id`) REFERENCES `registrants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`name` text NOT NULL,
	`host_email` text NOT NULL,
	`zoom_payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `zoom_events` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text,
	`type` text NOT NULL,
	`zoom_id` text NOT NULL,
	`zoom_uuid` text,
	`host_email` text NOT NULL,
	`topic` text NOT NULL,
	`start_time_utc` integer NOT NULL,
	`start_time_iana_tz` text NOT NULL,
	`join_url` text NOT NULL,
	`short_join_code` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`raw_response_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
