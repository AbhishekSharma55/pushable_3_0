import {
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const integrationStatusEnum = pgEnum("integration_status", [
    "active",
    "inactive",
    "pending",
    "failed",
]);

export const integrations = pgTable("integrations", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    composioToolkitSlug: text("composio_toolkit_slug").notNull(),
    composioConnectionId: text("composio_connection_id").notNull(),
    name: text("name").notNull(),
    status: integrationStatusEnum("status").default("pending").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
