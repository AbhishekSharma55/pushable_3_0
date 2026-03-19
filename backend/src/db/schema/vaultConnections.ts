import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const vaultProviderEnum = pgEnum("vault_provider", ["bitwarden"]);

export const vaultConnectionStatusEnum = pgEnum("vault_connection_status", [
    "active",
    "inactive",
    "failed",
]);

export const vaultConnections = pgTable("vault_connections", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: vaultProviderEnum("provider").notNull(),
    encryptedClientId: text("encrypted_client_id").notNull(),
    encryptedClientSecret: text("encrypted_client_secret").notNull(),
    encryptedMasterPassword: text("encrypted_master_password").notNull(),
    status: vaultConnectionStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
