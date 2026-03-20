import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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

    // OAuth tokens (encrypted at rest with AES-256-GCM)
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),

    // Vault decryption key: 64-byte (encKey+macKey) hex-encoded, then AES-256-GCM encrypted
    // Derived from master password during one-time connection — master password is never stored
    encryptedVaultKey: text("encrypted_vault_key").notNull(),

    // User's Bitwarden email (plaintext — needed for display and prelogin)
    email: text("email").notNull(),

    // KDF parameters from Bitwarden (needed if re-derivation is ever required)
    kdfIterations: integer("kdf_iterations").notNull(),

    // When the current access token expires
    tokenExpiresAt: timestamp("token_expires_at").notNull(),

    // Stable device identifier for this connection
    deviceIdentifier: text("device_identifier").notNull(),

    status: vaultConnectionStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
