import { pgTable, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { knowledgeBases } from "./knowledgeBases.ts";
import { workspaces } from "./workspaces.ts";

export const projectKnowledgeBases = pgTable("project_knowledge_bases", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
        .notNull()
        .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
    uniqueProjectKb: unique().on(table.projectId, table.kbId),
}));
