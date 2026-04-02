import { integer, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { users } from "./users.ts";

export const userCreditLimits = pgTable(
    "user_credit_limits",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        workspaceId: uuid("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        creditLimit: integer("credit_limit").notNull(),
        creditsUsed: integer("credits_used").default(0).notNull(),
        periodStart: timestamp("period_start").defaultNow().notNull(),
        periodEnd: timestamp("period_end"),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [unique().on(table.workspaceId, table.userId)]
);
