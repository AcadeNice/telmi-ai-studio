CREATE TABLE IF NOT EXISTS `admins` (`id` text PRIMARY KEY NOT NULL, `password_hash` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (`id` text PRIMARY KEY NOT NULL, `admin_id` text NOT NULL REFERENCES `admins`(`id`) ON DELETE cascade, `token_hash` text NOT NULL UNIQUE, `csrf_token` text NOT NULL, `expires_at` integer NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_token_idx` ON `sessions` (`token_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `login_attempts` (`key` text PRIMARY KEY NOT NULL, `failures` integer DEFAULT 0 NOT NULL, `window_started_at` integer NOT NULL, `blocked_until` integer);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (`id` text PRIMARY KEY DEFAULT 'primary' NOT NULL, `instance_name` text NOT NULL, `child_name` text NOT NULL, `public_url` text NOT NULL, `monthly_budget_cents` integer DEFAULT 2000 NOT NULL, `story_budget_cents` integer DEFAULT 300 NOT NULL, `store_enabled` integer DEFAULT true NOT NULL, `store_api_key_hash` text NOT NULL, `store_api_key_encrypted` text NOT NULL, `n8n_webhook_url` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `provider_configurations` (`id` text PRIMARY KEY NOT NULL, `type` text NOT NULL, `provider` text NOT NULL, `base_url` text, `model` text, `encrypted_api_key` text NOT NULL, `enabled` integer DEFAULT true NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `provider_type_unique` ON `provider_configurations` (`type`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stories` (`id` text PRIMARY KEY NOT NULL, `uuid` text NOT NULL UNIQUE, `title` text NOT NULL, `description` text DEFAULT '' NOT NULL, `age` integer NOT NULL, `active_version_id` text, `deleted_at` integer, `purge_after` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `stories_deleted_idx` ON `stories` (`deleted_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `story_versions` (`id` text PRIMARY KEY NOT NULL, `story_id` text NOT NULL REFERENCES `stories`(`id`) ON DELETE cascade, `version` integer NOT NULL, `status` text DEFAULT 'draft' NOT NULL, `schema_version` text DEFAULT '1.0' NOT NULL, `parameters_json` text NOT NULL, `raw_response_json` text, `start_scene_key` text, `validated_at` integer, `published_at` integer, `estimated_cost_cents` integer DEFAULT 0 NOT NULL, `actual_cost_cents` integer DEFAULT 0 NOT NULL, `pack_path` text, `cover_path` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `story_version_unique` ON `story_versions` (`story_id`,`version`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scenes` (`id` text PRIMARY KEY NOT NULL, `version_id` text NOT NULL REFERENCES `story_versions`(`id`) ON DELETE cascade, `key` text NOT NULL, `type` text NOT NULL, `title` text NOT NULL, `text` text NOT NULL, `image_prompt` text, `voice_id` text, `position_x` real DEFAULT 0 NOT NULL, `position_y` real DEFAULT 0 NOT NULL, `sort_order` integer DEFAULT 0 NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `scene_key_unique` ON `scenes` (`version_id`,`key`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `choices` (`id` text PRIMARY KEY NOT NULL, `version_id` text NOT NULL REFERENCES `story_versions`(`id`) ON DELETE cascade, `key` text NOT NULL, `source_scene_key` text NOT NULL, `label` text NOT NULL, `target_scene_key` text NOT NULL, `sort_order` integer DEFAULT 0 NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `choices_version_idx` ON `choices` (`version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `choice_key_unique` ON `choices` (`version_id`,`key`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `generation_jobs` (`id` text PRIMARY KEY NOT NULL, `version_id` text NOT NULL REFERENCES `story_versions`(`id`) ON DELETE cascade, `status` text DEFAULT 'queued' NOT NULL, `current_step` text, `progress` integer DEFAULT 0 NOT NULL, `override_budget` integer DEFAULT false NOT NULL, `error` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_steps` (`id` text PRIMARY KEY NOT NULL, `job_id` text NOT NULL REFERENCES `generation_jobs`(`id`) ON DELETE cascade, `step` text NOT NULL, `asset_id` text DEFAULT 'all' NOT NULL, `idempotency_key` text NOT NULL UNIQUE, `status` text DEFAULT 'pending' NOT NULL, `attempts` integer DEFAULT 0 NOT NULL, `result_json` text, `error` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `generated_assets` (`id` text PRIMARY KEY NOT NULL, `version_id` text NOT NULL REFERENCES `story_versions`(`id`) ON DELETE cascade, `scene_key` text, `type` text NOT NULL, `provider` text, `path` text NOT NULL, `mime_type` text NOT NULL, `bytes` integer DEFAULT 0 NOT NULL, `metadata_json` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `usage_records` (`id` text PRIMARY KEY NOT NULL, `version_id` text REFERENCES `story_versions`(`id`) ON DELETE set null, `provider` text NOT NULL, `operation` text NOT NULL, `units` real DEFAULT 0 NOT NULL, `cost_cents` integer DEFAULT 0 NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notifications` (`id` text PRIMARY KEY NOT NULL, `level` text NOT NULL, `title` text NOT NULL, `message` text NOT NULL, `read_at` integer, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `n8n_nonces` (`nonce` text PRIMARY KEY NOT NULL, `expires_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `backups` (`id` text PRIMARY KEY NOT NULL, `path` text NOT NULL, `bytes` integer NOT NULL, `created_at` integer NOT NULL);
