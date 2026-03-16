import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agentPermissions } from "../db/schema/index.ts";

export const permissionRepository = {
    async setPermission(data: {
        agentId: string;
        workspaceId: string;
        resourceType: "tool" | "kb" | "skill" | "agent";
        resourceId: string;
        allowed: boolean;
    }) {
        // Check if permission already exists
        const existing = await db
            .select()
            .from(agentPermissions)
            .where(
                and(
                    eq(agentPermissions.agentId, data.agentId),
                    eq(agentPermissions.resourceId, data.resourceId),
                    eq(agentPermissions.resourceType, data.resourceType)
                )
            )
            .limit(1);

        if (existing[0]) {
            const result = await db
                .update(agentPermissions)
                .set({ allowed: data.allowed })
                .where(eq(agentPermissions.id, existing[0].id))
                .returning();
            return result[0];
        }

        const result = await db
            .insert(agentPermissions)
            .values(data)
            .returning();
        return result[0];
    },

    async getPermissions(agentId: string, workspaceId: string) {
        return db
            .select()
            .from(agentPermissions)
            .where(
                and(
                    eq(agentPermissions.agentId, agentId),
                    eq(agentPermissions.workspaceId, workspaceId)
                )
            );
    },

    async getPermissionsByType(
        agentId: string,
        workspaceId: string,
        resourceType: "tool" | "kb" | "skill" | "agent"
    ) {
        return db
            .select()
            .from(agentPermissions)
            .where(
                and(
                    eq(agentPermissions.agentId, agentId),
                    eq(agentPermissions.workspaceId, workspaceId),
                    eq(agentPermissions.resourceType, resourceType)
                )
            );
    },

    async getAllowedResourceIds(
        agentId: string,
        workspaceId: string,
        resourceType: "tool" | "kb" | "skill" | "agent"
    ): Promise<string[]> {
        const permissions = await db
            .select()
            .from(agentPermissions)
            .where(
                and(
                    eq(agentPermissions.agentId, agentId),
                    eq(agentPermissions.workspaceId, workspaceId),
                    eq(agentPermissions.resourceType, resourceType),
                    eq(agentPermissions.allowed, true)
                )
            );
        return permissions.map((p) => p.resourceId);
    },

    async deletePermission(
        agentId: string,
        resourceId: string,
        resourceType: "tool" | "kb" | "skill" | "agent"
    ) {
        await db
            .delete(agentPermissions)
            .where(
                and(
                    eq(agentPermissions.agentId, agentId),
                    eq(agentPermissions.resourceId, resourceId),
                    eq(agentPermissions.resourceType, resourceType)
                )
            );
    },
};
