import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const emailWorkspaceAddresses = pgTable("email_workspace_addresses", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .unique()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    address: text("address").notNull().unique(),
    displayName: text("display_name"),
    customInstructions: text("custom_instructions"),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
