import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { users } from "./users.ts";

export const telegramUserLinks = pgTable("telegram_user_links", {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramUserId: text("telegram_user_id").notNull().unique(),
    telegramUsername: text("telegram_username"),
    telegramFirstName: text("telegram_first_name"),
    telegramChatId: text("telegram_chat_id"),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
        onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at"),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
