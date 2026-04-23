import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const platformBotConfigs = pgTable("platform_bot_configs", {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull().unique(),
    config: jsonb("config").default({}).notNull(),
    status: text("status").default("inactive").notNull(),
    botName: text("bot_name"),
    botUsername: text("bot_username"),
    errorMessage: text("error_message"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    updatedBy: text("updated_by"),
});
