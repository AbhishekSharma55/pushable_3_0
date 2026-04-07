import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const emailApprovedSenders = pgTable("email_approved_senders", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    senderPattern: text("sender_pattern").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
