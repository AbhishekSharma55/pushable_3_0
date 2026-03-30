import {
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { workflows } from "./workflows.ts";

export const workflowRunStatusEnum = pgEnum("workflow_run_status", [
    "running",
    "completed",
    "failed",
]);

export const workflowRuns = pgTable("workflow_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
        .notNull()
        .references(() => workflows.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    status: workflowRunStatusEnum("status").notNull().default("running"),
    inputData: jsonb("input_data").default({}).notNull(),
    resultText: text("result_text"),
    error: text("error"),
    creditsUsed: integer("credits_used").default(0).notNull(),
    durationMs: integer("duration_ms"),
    stepResults: jsonb("step_results").default([]).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
});
