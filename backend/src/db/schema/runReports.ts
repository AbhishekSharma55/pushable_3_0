import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";
import { projects } from "./projects.ts";
import { sessions } from "./sessions.ts";
import { schedules } from "./schedules.ts";

export const runReports = pgTable("run_reports", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
        .references(() => projects.id, { onDelete: "set null" }),
    sessionId: uuid("session_id")
        .references(() => sessions.id, { onDelete: "set null" }),
    scheduleId: uuid("schedule_id")
        .references(() => schedules.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    actionsTaken: text("actions_taken"),
    outcomes: text("outcomes"),
    issues: text("issues"),
    metrics: jsonb("metrics").default({}).notNull(),
    data: jsonb("data").default({}).notNull(),
    runType: text("run_type").notNull().default("scheduled"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
