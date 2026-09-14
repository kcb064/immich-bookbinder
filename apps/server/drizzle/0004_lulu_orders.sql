CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text,
	`render_id` text,
	`file_path` text,
	`token` text NOT NULL,
	`md5` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`render_id`) REFERENCES `renders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exports_token_unique` ON `exports` (`token`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`lulu_job_id` text,
	`env` text NOT NULL,
	`status` text NOT NULL,
	`lulu_status` text,
	`pod_package_id` text NOT NULL,
	`page_count` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`shipping_level` text NOT NULL,
	`shipping_address` text NOT NULL,
	`contact_email` text NOT NULL,
	`cost` text,
	`shipping_options` text DEFAULT '[]' NOT NULL,
	`interior_export_id` text,
	`cover_export_id` text,
	`validation` text DEFAULT '{}' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`tracking` text DEFAULT '[]' NOT NULL,
	`external_id` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
