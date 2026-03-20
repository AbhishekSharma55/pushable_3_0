import {
    boolean,
    integer,
    numeric,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";

export const llmProviderEnum = pgEnum("llm_provider", [
    "openai",
    "anthropic",
    "google",
    "deepseek",
    "meta",
]);

export const planTierEnum = pgEnum("plan_tier", [
    "free",
    "starter",
    "pro",
    "scale",
]);

export const llmModels = pgTable("llm_models", {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: llmProviderEnum("provider").notNull(),
    modelId: text("model_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    multiplier: numeric("multiplier", { precision: 4, scale: 2 })
        .notNull()
        .default("1.00"),
    contextWindow: integer("context_window"),
    isActive: boolean("is_active").default(true).notNull(),
    minimumPlan: planTierEnum("minimum_plan").default("pro").notNull(),
    isFeatured: boolean("is_featured").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
