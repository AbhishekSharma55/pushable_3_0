import { boolean, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const credits = pgTable("credits", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .unique()
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    balance: integer("balance").default(1000).notNull(),
    planCredits: integer("plan_credits").default(1000).notNull(),
    topupCredits: integer("topup_credits").default(0).notNull(),
    overageEnabled: boolean("overage_enabled").default(false).notNull(),
    overageLimit: integer("overage_limit").default(500).notNull(),
    totalCreditsConsumed: integer("total_credits_consumed").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
