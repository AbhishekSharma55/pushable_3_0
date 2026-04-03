import { boolean, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const credits = pgTable("credits", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .unique()
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    balance: numeric("balance", { precision: 12, scale: 4 }).default("1000").notNull(),
    planCredits: numeric("plan_credits", { precision: 12, scale: 4 }).default("1000").notNull(),
    topupCredits: numeric("topup_credits", { precision: 12, scale: 4 }).default("0").notNull(),
    overageEnabled: boolean("overage_enabled").default(false).notNull(),
    overageLimit: numeric("overage_limit", { precision: 12, scale: 4 }).default("500").notNull(),
    totalCreditsConsumed: numeric("total_credits_consumed", { precision: 12, scale: 4 }).default("0").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
