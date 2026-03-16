import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { sessions } from "../db/schema/index.ts";

export const sessionRepository = {
    async create(data: {
        workspaceId: string;
        agentId: string;
        title: string;
    }) {
        const result = await db.insert(sessions).values(data).returning();
        return result[0];
    },

    async findByAgent(agentId: string, workspaceId: string) {
        return db
            .select()
            .from(sessions)
            .where(
                and(
                    eq(sessions.agentId, agentId),
                    eq(sessions.workspaceId, workspaceId)
                )
            )
            .orderBy(sessions.createdAt);
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(sessions)
            .where(
                and(eq(sessions.id, id), eq(sessions.workspaceId, workspaceId))
            )
            .limit(1);
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(sessions)
            .where(
                and(eq(sessions.id, id), eq(sessions.workspaceId, workspaceId))
            );
    },
};
