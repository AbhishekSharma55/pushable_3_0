import {
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { sessions } from "./sessions.ts";

export const runStatusEnum = pgEnum("run_status", [
    "queued",
    "in_progress",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
]);

export const runs = pgTable("runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("queued"),
    error: text("error"),
    metadata: jsonb("metadata").default("{}").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
