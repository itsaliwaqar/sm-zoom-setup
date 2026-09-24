ALTER TABLE `registration_routes` ADD `ghl_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `registration_routes` ADD `outbound_webhook_config_json` text;--> statement-breakpoint
ALTER TABLE `scheduled_jobs` ADD `horizon_days` integer DEFAULT 0 NOT NULL;