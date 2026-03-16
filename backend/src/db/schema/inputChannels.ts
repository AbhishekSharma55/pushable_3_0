import {
    boolean,
    jsonb,
    pgEnum,
    pgTable,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";

export const channelTypeEnum = pgEnum("channel_type", ["telegram", "slack"]);

export const inputChannels = pgTable("input_channels", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id),
    type: channelTypeEnum("type").notNull(),
    config: jsonb("config").default({}).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
