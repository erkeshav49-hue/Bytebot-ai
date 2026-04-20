CREATE TABLE `bot_state` (
	`id` int NOT NULL,
	`state` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_state_id` PRIMARY KEY(`id`)
);
