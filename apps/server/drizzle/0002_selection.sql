CREATE TABLE `candidates` (
	`book_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`decision` text NOT NULL,
	`cluster_id` text,
	`composite` real DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`book_id`, `asset_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `selection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`status` text NOT NULL,
	`phase` text DEFAULT 'queued' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
