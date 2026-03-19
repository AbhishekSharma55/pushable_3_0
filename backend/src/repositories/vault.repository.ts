import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { vaultConnections } from "../db/schema/index.ts";

export const vaultRepository = {
    async create(data: {
        workspaceId: string;
        provider: "bitwarden";
        encryptedClientId: string;
        encryptedClientSecret: string;
        encryptedMasterPassword: string;
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
};
