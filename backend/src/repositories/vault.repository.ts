import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { vaultConnections, vaultAuditLogs } from "../db/schema/index.ts";

export const vaultRepository = {
    async create(data: {
        workspaceId: string;
        provider: "bitwarden";
        encryptedAccessToken: string;
        encryptedRefreshToken: string;
        encryptedVaultKey: string;
        email: string;
        kdfIterations: number;
        tokenExpiresAt: Date;
        deviceIdentifier: string;
        status?: "active" | "inactive" | "failed";
    }) {
        const result = await db
            .insert(vaultConnections)
            .values(data)
            .returning();
        return result[0];
    },

    async findByWorkspace(workspaceId: string) {
        const result = await db
            .select()
            .from(vaultConnections)
            .where(eq(vaultConnections.workspaceId, workspaceId))
            .limit(1);
        return result[0] ?? null;
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(vaultConnections)
            .where(
                and(
                    eq(vaultConnections.id, id),
                    eq(vaultConnections.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async updateStatus(
        id: string,
        status: "active" | "inactive" | "failed"
    ) {
        const result = await db
            .update(vaultConnections)
            .set({ status, updatedAt: new Date() })
            .where(eq(vaultConnections.id, id))
            .returning();
        return result[0] ?? null;
    },

    /**
     * Atomically update both tokens and expiry in a single UPDATE.
     * Prevents partial updates where access_token is updated but refresh_token isn't.
     */
    async updateTokens(
        id: string,
        data: {
            encryptedAccessToken: string;
            encryptedRefreshToken: string;
            tokenExpiresAt: Date;
        }
    ) {
        const result = await db
            .update(vaultConnections)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(vaultConnections.id, id))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(vaultConnections)
            .where(
                and(
                    eq(vaultConnections.id, id),
                    eq(vaultConnections.workspaceId, workspaceId)
                )
            );
    },

    async deleteByWorkspace(workspaceId: string) {
        await db
            .delete(vaultConnections)
            .where(eq(vaultConnections.workspaceId, workspaceId));
    },

    // ─── Audit Logging ───────────────────────────────────────────────────────

    async logAudit(data: {
        workspaceId: string;
        connectionId?: string;
        action:
            | "connect"
            | "disconnect"
            | "credential_fetch"
            | "token_refresh"
            | "test"
            | "error";
        itemName?: string;
        success: boolean;
        errorMessage?: string;
        metadata?: Record<string, unknown>;
    }) {
        await db.insert(vaultAuditLogs).values({
            workspaceId: data.workspaceId,
            connectionId: data.connectionId ?? null,
            action: data.action,
            itemName: data.itemName ?? null,
            success: data.success,
            errorMessage: data.errorMessage ?? null,
            metadata: data.metadata ?? null,
        });
    },
};
