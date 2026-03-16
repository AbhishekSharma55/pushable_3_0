import {
    boolean,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const toolTypeEnum = pgEnum("tool_type", ["mcp", "function"]);

export const tools = pgTable("tools", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: toolTypeEnum("type").notNull(),
    config: jsonb("config").default({}).notNull(),
    isGlobal: boolean("is_global").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
