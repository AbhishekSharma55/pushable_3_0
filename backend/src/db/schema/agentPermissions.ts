import {
    boolean,
    pgEnum,
    pgTable,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";

export const resourceTypeEnum = pgEnum("resource_type", [
    "tool",
    "kb",
    "skill",
]);

export const agentPermissions = pgTable("agent_permissions", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    resourceType: resourceTypeEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    allowed: boolean("allowed").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
