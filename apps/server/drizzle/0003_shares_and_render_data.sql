CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`token` text NOT NULL,
	`password_hash` text,
	`expires_at` text,
	`allow_download` integer DEFAULT false NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`last_viewed_at` text,
	`views` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);--> statement-breakpoint
ALTER TABLE `renders` ADD `data` text;