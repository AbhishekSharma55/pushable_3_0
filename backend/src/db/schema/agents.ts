import { boolean, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const agents = pgTable("agents", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt"),
    model: text("model").default("gpt-4o-mini").notNull(),
    temperature: real("temperature").default(0.7).notNull(),
    // System-level access
    systemLevelAccess: boolean("system_level_access").default(false).notNull(),
    canManageKB: boolean("can_manage_kb").default(false).notNull(),
    canManageSkills: boolean("can_manage_skills").default(false).notNull(),
    canManageTools: boolean("can_manage_tools").default(false).notNull(),
    canManageSchedules: boolean("can_manage_schedules").default(false).notNull(),
    canManageTasks: boolean("can_manage_tasks").default(false).notNull(),
    canManageChannels: boolean("can_manage_channels").default(false).notNull(),
    canManageAgents: boolean("can_manage_agents").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
