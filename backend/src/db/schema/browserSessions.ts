import {
    pgEnum,
    pgTable,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { browserProfiles } from "./browserProfiles.ts";
import { agents } from "./agents.ts";

export const browserSessionStatusEnum = pgEnum("browser_session_status", [
    "starting",
    "active",
    "closed",
    "error",
]);

export const browserSessions = pgTable("browser_sessions", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
        .notNull()
        .references(() => browserProfiles.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .references(() => agents.id, { onDelete: "set null" }),
    taskId: uuid("task_id"),
    status: browserSessionStatusEnum("status").default("starting").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
});
