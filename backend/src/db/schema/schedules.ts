import {
    boolean,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const scheduleTargetTypeEnum = pgEnum("schedule_target_type", [
    "task",
    "workflow",
]);

export const schedules = pgTable("schedules", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
    name: text("name").notNull(),
    cron: text("cron").notNull(),
    targetType: scheduleTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
