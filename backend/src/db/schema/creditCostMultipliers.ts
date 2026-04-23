import {
    boolean,
    integer,
    numeric,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

export const creditCostMultipliers = pgTable("credit_cost_multipliers", {
    id: uuid("id").primaryKey().defaultRandom(),
    aboveDollar: numeric("above_dollar", { precision: 10, scale: 6 }).notNull(),
    multiplier: numeric("multiplier", { precision: 10, scale: 4 }).notNull(),
    label: text("label"),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
