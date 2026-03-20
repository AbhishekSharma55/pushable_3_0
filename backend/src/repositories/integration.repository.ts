import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { integrations, agentIntegrations } from "../db/schema/index.ts";

export const integrationRepository = {
    async create(data: {
        workspaceId: string;
        composioToolkitSlug: string;
        composioConnectionId: string;
        name: string;
        connectionLabel: string;
        connectionDescription?: string;
        connectionIcon?: string;
        status?: "active" | "inactive" | "pending" | "failed";
        metadata?: Record<string, unknown>;
    }) {
        const result = await db.insert(integrations).values(data).returning();
        return result[0];
    },

    async findByLabelInWorkspace(label: string, workspaceId: string) {
        const result = await db
            .select()
            .from(integrations)
            .where(
                and(
                    eq(integrations.connectionLabel, label),
                    eq(integrations.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async updateConnection(
        id: string,
        workspaceId: string,
        data: Partial<{
            connectionLabel: string;
            connectionDescription: string;
        }>
    ) {
        const result = await db
            .update(integrations)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(integrations.id, id),
                    eq(integrations.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async updateMetadata(
        id: string,
        workspaceId: string,
        metadata: Record<string, unknown>
    ) {
        const result = await db
            .update(integrations)
            .set({ metadata, updatedAt: new Date() })
            .where(
                and(
                    eq(integrations.id, id),
                    eq(integrations.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(integrations)
            .where(
                and(
                    eq(integrations.id, id),
                    eq(integrations.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(integrations)
            .where(eq(integrations.workspaceId, workspaceId))
            .orderBy(integrations.createdAt);
    },

    async updateStatus(
        id: string,
        status: "active" | "inactive" | "pending" | "failed",
        composioConnectionId?: string
    ) {
        const data: Record<string, unknown> = {
            status,
            updatedAt: new Date(),
        };
        if (composioConnectionId) {
            data.composioConnectionId = composioConnectionId;
        }
        const result = await db
            .update(integrations)
            .set(data)
            .where(eq(integrations.id, id))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        // Agent integrations cascade-deleted via FK
        await db
            .delete(integrations)
            .where(
                and(
                    eq(integrations.id, id),
                    eq(integrations.workspaceId, workspaceId)
                )
            );
    },

    async assignToAgent(
        agentId: string,
        integrationId: string,
        workspaceId: string
    ) {
        const result = await db
            .insert(agentIntegrations)
            .values({ agentId, integrationId, workspaceId })
            .returning();
        return result[0];
    },

    async removeFromAgent(
        agentId: string,
        integrationId: string,
        workspaceId: string
    ) {
        await db
            .delete(agentIntegrations)
            .where(
                and(
                    eq(agentIntegrations.agentId, agentId),
                    eq(agentIntegrations.integrationId, integrationId),
                    eq(agentIntegrations.workspaceId, workspaceId)
                )
            );
    },

    async findByAgent(agentId: string, workspaceId: string) {
        const assignments = await db
            .select()
            .from(agentIntegrations)
            .where(
                and(
                    eq(agentIntegrations.agentId, agentId),
                    eq(agentIntegrations.workspaceId, workspaceId)
                )
            );

        if (assignments.length === 0) return [];

        const results = [];
        for (const assignment of assignments) {
            const integration = await this.findById(
                assignment.integrationId,
                workspaceId
            );
            if (integration) results.push(integration);
        }
        return results;
    },
};
