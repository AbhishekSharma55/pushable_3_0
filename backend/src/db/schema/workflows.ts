import {
    boolean,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";

export const workflows = pgTable("workflows", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    inputSchema: jsonb("input_schema").default({}).notNull(),
    recipe: jsonb("recipe").default({}).notNull(),
    sourceSessionId: uuid("source_session_id"),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at"),
    runCount: integer("run_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
