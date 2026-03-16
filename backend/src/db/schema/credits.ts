import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const credits = pgTable("credits", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .unique()
        .notNull()
        .references(() => workspaces.id),
    balance: integer("balance").default(1000).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
