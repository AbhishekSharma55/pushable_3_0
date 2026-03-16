import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agents } from "../db/schema/index.ts";

export const agentRepository = {
    async create(data: {
        workspaceId: string;
        name: string;
        systemPrompt?: string;
        model?: string;
        temperature?: number;
    }) {
        const result = await db.insert(agents).values(data).returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(agents)
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(agents)
            .where(eq(agents.workspaceId, workspaceId))
            .orderBy(agents.createdAt);
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            systemPrompt: string;
            model: string;
            temperature: number;
        }>
    ) {
        const result = await db
            .update(agents)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(agents)
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    },
};
