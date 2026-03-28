import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { testSuites } from "./testSuites.ts";

export const testCases = pgTable("test_cases", {
    id: uuid("id").primaryKey().defaultRandom(),
    suiteId: uuid("suite_id")
        .notNull()
        .references(() => testSuites.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    input: text("input").notNull(),
    expectedBehavior: text("expected_behavior").notNull(),
    actualResponse: text("actual_response"),
    status: text("status").notNull().default("pending"),
    evaluationNotes: text("evaluation_notes"),
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    executedAt: timestamp("executed_at"),
});
