import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { userAgentAccess } from "../db/schema/index.ts";

export const userAgentAccessRepository = {
    async findByUser(workspaceId: string, userId: string) {
        return db
            .select()
            .from(userAgentAccess)
            .where(
                and(
                    eq(userAgentAccess.workspaceId, workspaceId),
                    eq(userAgentAccess.userId, userId)
                )
            );
    },

    async hasAnyRestrictions(workspaceId: string, userId: string): Promise<boolean> {
        const result = await db
            .select()
            .from(userAgentAccess)
            .where(
                and(
                    eq(userAgentAccess.workspaceId, workspaceId),
                    eq(userAgentAccess.userId, userId)
                )
            )
            .limit(1);
        return result.length > 0;
    },

    async isAgentAllowed(
        workspaceId: string,
        userId: string,
        agentId: string
    ): Promise<boolean> {
        // Check if this specific agent is explicitly allowed
        // No rows = no access (default deny for invited members)
        const result = await db
            .select()
            .from(userAgentAccess)
            .where(
                and(
                    eq(userAgentAccess.workspaceId, workspaceId),
                    eq(userAgentAccess.userId, userId),
                    eq(userAgentAccess.agentId, agentId),
                    eq(userAgentAccess.allowed, true)
                )
            )
            .limit(1);
        return result.length > 0;
    },

    async setAccess(data: {
        workspaceId: string;
        userId: string;
        agentId: string;
        allowed: boolean;
    }) {
        const existing = await db
            .select()
            .from(userAgentAccess)
            .where(
                and(
                    eq(userAgentAccess.workspaceId, data.workspaceId),
                    eq(userAgentAccess.userId, data.userId),
                    eq(userAgentAccess.agentId, data.agentId)
                )
            )
            .limit(1);

        if (existing[0]) {
            const result = await db
                .update(userAgentAccess)
                .set({ allowed: data.allowed })
                .where(eq(userAgentAccess.id, existing[0].id))
                .returning();
            return result[0];
        }

        const result = await db
            .insert(userAgentAccess)
            .values(data)
            .returning();
        return result[0];
    },

    async bulkSetAccess(
        workspaceId: string,
        userId: string,
        entries: { agentId: string; allowed: boolean }[]
    ) {
        const results = [];
        for (const entry of entries) {
            const result = await this.setAccess({
                workspaceId,
                userId,
                agentId: entry.agentId,
                allowed: entry.allowed,
            });
            results.push(result);
        }
        return results;
    },

    async deleteByUser(workspaceId: string, userId: string) {
        await db
            .delete(userAgentAccess)
            .where(
                and(
                    eq(userAgentAccess.workspaceId, workspaceId),
                    eq(userAgentAccess.userId, userId)
                )
            );
    },
};
