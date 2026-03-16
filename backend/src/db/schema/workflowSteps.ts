import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { workflows } from "./workflows.ts";
import { tasks } from "./tasks.ts";

export const workflowSteps = pgTable("workflow_steps", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
        .notNull()
        .references(() => workflows.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
        .notNull()
        .references(() => tasks.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
