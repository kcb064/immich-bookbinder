CREATE TABLE `book_assets` (
	`book_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`book_id`, `asset_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `renders` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`pages_total` integer DEFAULT 0 NOT NULL,
	`pages_done` integer DEFAULT 0 NOT NULL,
	`page_count` integer,
	`file_size_bytes` integer,
	`file_path` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
