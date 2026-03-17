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

export const connectionChannelTypeEnum = pgEnum("connection_channel_type", [
    "telegram",
    "slack",
]);

export const connectionStatusEnum = pgEnum("connection_status", [
    "active",
    "inactive",
    "error",
]);

export const channelConnections = pgTable("channel_connections", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    channelType: connectionChannelTypeEnum("channel_type").notNull(),
    name: text("name").notNull(),
    status: connectionStatusEnum("status").default("inactive").notNull(),
    credentials: jsonb("credentials").default({}).notNull(),
    config: jsonb("config").default({}).notNull(),
    errorMessage: text("error_message"),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
