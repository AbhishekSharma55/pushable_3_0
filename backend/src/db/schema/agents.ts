import { boolean, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { browserProxies } from "./browserProxies.ts";

export const agents = pgTable("agents", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji"),
    systemPrompt: text("system_prompt"),
    model: text("model").default("openai/gpt-4o-mini").notNull(),
    temperature: real("temperature").default(0.7).notNull(),
    // System-level access
    systemLevelAccess: boolean("system_level_access").default(false).notNull(),
    canManageKB: boolean("can_manage_kb").default(false).notNull(),
    canManageSkills: boolean("can_manage_skills").default(false).notNull(),
    canManageTools: boolean("can_manage_tools").default(false).notNull(),
    canManageSchedules: boolean("can_manage_schedules").default(false).notNull(),
    canManageChannels: boolean("can_manage_channels").default(false).notNull(),
    canManageAgents: boolean("can_manage_agents").default(false).notNull(),
    canManageBucket: boolean("can_manage_bucket").default(true).notNull(),
    canExecutePython: boolean("can_execute_python").default(true).notNull(),
    bucketFolder: text("bucket_folder"),
    requireApprovalForAll: boolean("require_approval_for_all").default(false).notNull(),
    // Browser automation
    browserType: text("browser_type").default("cloud").notNull(),
    browserEnabled: boolean("browser_enabled").default(true).notNull(),
    browserProxyId: uuid("browser_proxy_id").references(() => browserProxies.id, { onDelete: "set null" }),
    // CEO / Tester / agent type
    isCeo: boolean("is_ceo").default(false).notNull(),
    isTester: boolean("is_tester").default(false).notNull(),
    agentType: text("agent_type").default("worker").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
