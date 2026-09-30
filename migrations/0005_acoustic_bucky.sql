CREATE TABLE `attendee_flow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`zoom_event_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`attendee_count` integer,
	`summary_json` text,
	`error` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`flow_id`) REFERENCES `attendee_flows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`zoom_event_id`) REFERENCES `zoom_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `attendee_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`series_id` text,
	`auto_run` integer DEFAULT true NOT NULL,
	`min_minutes` integer DEFAULT 0 NOT NULL,
	`exclude_emails_json` text,
	`actions_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
