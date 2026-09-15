ALTER TABLE `orders` ADD `line_items` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `imported` integer DEFAULT false NOT NULL;