import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agentMemories } from "../db/schema/agentMemories.ts";

export const memoryRepository = {
    async findByUser(workspaceId: string, agentId: string, userId: string) {
        return db
            .select()
            .from(agentMemories)
            .where(
                and(
                    eq(agentMemories.workspaceId, workspaceId),
                    eq(agentMemories.agentId, agentId),
                    eq(agentMemories.userId, userId)
                )
            )
            .orderBy(desc(agentMemories.createdAt))
            .limit(50);
    },

    async create(data: {
        workspaceId: string;
        agentId: string;
        userId: string;
        content: string;
        category?: string;
    }) {
        const [memory] = await db
            .insert(agentMemories)
            .values({
                workspaceId: data.workspaceId,
                agentId: data.agentId,
                userId: data.userId,
                content: data.content,
                category: data.category || "general",
            })
            .returning();
        return memory;
    },

    async deleteById(id: string, workspaceId: string) {
        return db
            .delete(agentMemories)
            .where(
                and(
                    eq(agentMemories.id, id),
                    eq(agentMemories.workspaceId, workspaceId)
                )
            );
    },

    async deleteByUser(workspaceId: string, agentId: string, userId: string) {
        return db
            .delete(agentMemories)
            .where(
                and(
                    eq(agentMemories.workspaceId, workspaceId),
                    eq(agentMemories.agentId, agentId),
                    eq(agentMemories.userId, userId)
                )
            );
    },
};
