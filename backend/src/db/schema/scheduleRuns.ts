import {
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { schedules } from "./schedules.ts";

export const scheduleRunStatusEnum = pgEnum("schedule_run_status", [
    "running",
    "completed",
    "failed",
    "skipped",
]);

export const scheduleRuns = pgTable("schedule_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id")
        .notNull()
        .references(() => schedules.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    status: scheduleRunStatusEnum("status").notNull().default("running"),
    resultText: text("result_text"),
    error: text("error"),
    creditsUsed: integer("credits_used").default(0).notNull(),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
});
