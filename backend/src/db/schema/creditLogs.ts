import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const creditLogs = pgTable("credit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id"),
    sessionId: uuid("session_id"),
    tokensUsed: integer("tokens_used").notNull(),
    creditsDeducted: numeric("credits_deducted", { precision: 12, scale: 4 }).notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
