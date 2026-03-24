import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { channelConnections } from "../db/schema/index.ts";

export const channelRepository = {
    async create(data: {
        workspaceId: string;
        agentId: string;
        channelType: "telegram" | "slack";
        name: string;
        credentials: Record<string, unknown>;
        config?: Record<string, unknown>;
    }) {
        const result = await db
            .insert(channelConnections)
            .values({ ...data, status: "inactive" })
            .returning();
        return result[0];
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(channelConnections)
            .where(eq(channelConnections.workspaceId, workspaceId))
            .orderBy(channelConnections.createdAt);
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(channelConnections)
            .where(
                and(
                    eq(channelConnections.id, id),
                    eq(channelConnections.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByIdGlobal(id: string) {
        const result = await db
            .select()
            .from(channelConnections)
            .where(eq(channelConnections.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            agentId: string;
            credentials: Record<string, unknown>;
            config: Record<string, unknown>;
            status: "active" | "inactive" | "error";
            errorMessage: string | null;
        }>
    ) {
        const result = await db
            .update(channelConnections)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(channelConnections.id, id),
                    eq(channelConnections.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async updateStatus(
        id: string,
        status: "active" | "inactive" | "error",
        errorMessage?: string
    ) {
        await db
            .update(channelConnections)
            .set({
                status,
                errorMessage: errorMessage ?? null,
                updatedAt: new Date(),
            })
            .where(eq(channelConnections.id, id));
    },

    async updateLastMessageAt(id: string) {
        await db
            .update(channelConnections)
            .set({ lastMessageAt: new Date() })
            .where(eq(channelConnections.id, id));
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(channelConnections)
            .where(
                and(
                    eq(channelConnections.id, id),
                    eq(channelConnections.workspaceId, workspaceId)
                )
            );
    },

    async findActiveConnections() {
        return db
            .select()
            .from(channelConnections)
            .where(eq(channelConnections.status, "active"));
    },
};
