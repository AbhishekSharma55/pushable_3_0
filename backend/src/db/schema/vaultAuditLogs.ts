import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const vaultAuditActionEnum = pgEnum("vault_audit_action", [
    "connect",
    "disconnect",
    "credential_fetch",
    "token_refresh",
    "test",
    "error",
]);

export const vaultAuditLogs = pgTable("vault_audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    action: vaultAuditActionEnum("action").notNull(),
    itemName: text("item_name"), // search term (for credential_fetch), never the actual password
    success: boolean("success").notNull(),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"), // extra context (e.g., item count, refresh reason)
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
