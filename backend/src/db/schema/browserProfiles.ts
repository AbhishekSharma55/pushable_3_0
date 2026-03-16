import {
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";

export const browserProfileStatusEnum = pgEnum("browser_profile_status", [
    "active",
    "inactive",
]);

export const browserProfiles = pgTable("browser_profiles", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    profilePath: text("profile_path").notNull(),
    assignedAgentId: uuid("assigned_agent_id")
        .references(() => agents.id, { onDelete: "set null" }),
    os: text("os").default("windows").notNull(),
    status: browserProfileStatusEnum("status").default("active").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
