import { pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { agents } from "./agents.ts";
import { workspaces } from "./workspaces.ts";

export const projectAgents = pgTable("project_agents", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    roleInProject: text("role_in_project"),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
    uniqueProjectAgent: unique().on(table.projectId, table.agentId),
}));
