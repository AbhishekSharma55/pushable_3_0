import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { users } from "./users.ts";

export const whatsappUserLinks = pgTable("whatsapp_user_links", {
    id: uuid("id").primaryKey().defaultRandom(),
    whatsappPhone: text("whatsapp_phone").notNull().unique(),
    whatsappName: text("whatsapp_name"),
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
