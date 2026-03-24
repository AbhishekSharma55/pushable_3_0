import {
    boolean,
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";

export const scheduleTypeEnum = pgEnum("schedule_type", [
    "natural",
    "preset",
    "custom",
]);

export const schedules = pgTable("schedules", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    cron: text("cron").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),

    // Human-like scheduling fields
    naturalLanguage: text("natural_language"),
    humanizeDelay: integer("humanize_delay").default(0).notNull(),
    timezone: text("timezone").default("UTC").notNull(),
    businessHoursOnly: boolean("business_hours_only").default(false).notNull(),
    workStartHour: integer("work_start_hour").default(9).notNull(),
    workEndHour: integer("work_end_hour").default(18).notNull(),
    workDays: integer("work_days").array().default([1, 2, 3, 4, 5]).notNull(),
    scheduleType: scheduleTypeEnum("schedule_type").default("natural").notNull(),
    presetKey: text("preset_key"),
    nextRunDescription: text("next_run_description"),
});
