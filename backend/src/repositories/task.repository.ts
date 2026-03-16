import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tasks } from "../db/schema/index.ts";

export const taskRepository = {
    async create(data: {
        workspaceId: string;
        agentId: string;
        title: string;
        description?: string;
    }) {
        const result = await db.insert(tasks).values(data).returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(tasks)
            .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(tasks)
            .where(eq(tasks.workspaceId, workspaceId))
            .orderBy(tasks.createdAt);
    },

    async findByAgent(agentId: string, workspaceId: string) {
        return db
            .select()
            .from(tasks)
            .where(
                and(
                    eq(tasks.agentId, agentId),
                    eq(tasks.workspaceId, workspaceId)
                )
            )
            .orderBy(tasks.createdAt);
    },

    async updateStatus(
        id: string,
        status: "pending" | "running" | "done" | "failed",
        result?: string
    ) {
        const data: Record<string, unknown> = {
            status,
            updatedAt: new Date(),
        };
        if (result !== undefined) data.result = result;

        const res = await db
            .update(tasks)
            .set(data)
            .where(eq(tasks.id, id))
            .returning();
        return res[0] ?? null;
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            title: string;
            description: string;
            agentId: string;
        }>
    ) {
        const result = await db
            .update(tasks)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(tasks)
            .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)));
    },
};
