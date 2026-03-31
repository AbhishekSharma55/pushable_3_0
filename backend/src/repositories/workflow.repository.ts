import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workflows } from "../db/schema/index.ts";

export const workflowRepository = {
    async create(data: {
        workspaceId: string;
        agentId: string;
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        recipe?: Record<string, unknown>;
        sourceSessionId?: string;
        enabled?: boolean;
    }) {
        const result = await db.insert(workflows).values(data).returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(workflows)
            .where(
                and(
                    eq(workflows.id, id),
                    eq(workflows.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(workflows)
            .where(eq(workflows.workspaceId, workspaceId))
            .orderBy(desc(workflows.createdAt));
    },

    async findByName(name: string, agentId: string, workspaceId: string) {
        const result = await db
            .select()
            .from(workflows)
            .where(
                and(
                    eq(workflows.name, name),
                    eq(workflows.agentId, agentId),
                    eq(workflows.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByAgent(agentId: string, workspaceId: string) {
        return db
            .select()
            .from(workflows)
            .where(
                and(
                    eq(workflows.agentId, agentId),
                    eq(workflows.workspaceId, workspaceId)
                )
            )
            .orderBy(desc(workflows.createdAt));
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
            recipe: Record<string, unknown>;
            enabled: boolean;
        }>
    ) {
        const result = await db
            .update(workflows)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(workflows.id, id),
                    eq(workflows.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async updateLastRunAt(id: string) {
        await db
            .update(workflows)
            .set({ lastRunAt: new Date() })
            .where(eq(workflows.id, id));
    },

    async incrementRunCount(id: string) {
        await db
            .update(workflows)
            .set({ runCount: sql`${workflows.runCount} + 1` })
            .where(eq(workflows.id, id));
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(workflows)
            .where(
                and(
                    eq(workflows.id, id),
                    eq(workflows.workspaceId, workspaceId)
                )
            );
    },
};
