import {
    boolean,
    integer,
    numeric,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

export const creditCostRanges = pgTable("credit_cost_ranges", {
    id: uuid("id").primaryKey().defaultRandom(),
    minDollar: numeric("min_dollar", { precision: 10, scale: 6 }).notNull(),
    maxDollar: numeric("max_dollar", { precision: 10, scale: 6 }).notNull(),
    creditAmount: numeric("credit_amount", { precision: 8, scale: 4 }).notNull(),
    label: text("label"),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
