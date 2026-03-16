import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tools } from "../db/schema/index.ts";

export const toolRepository = {
    async create(data: {
        workspaceId: string;
        name: string;
        description?: string;
        type: "mcp" | "function";
        config: Record<string, unknown>;
        isGlobal?: boolean;
    }) {
        const result = await db.insert(tools).values(data).returning();
        return result[0];
    },

    async findById(id: string) {
        const result = await db
            .select()
            .from(tools)
            .where(eq(tools.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(tools)
            .where(
                or(
                    eq(tools.workspaceId, workspaceId),
                    eq(tools.isGlobal, true)
                )
            )
            .orderBy(tools.createdAt);
    },

    async update(
        id: string,
        data: Partial<{
            name: string;
            description: string;
            type: "mcp" | "function";
            config: Record<string, unknown>;
            isGlobal: boolean;
        }>
    ) {
        const result = await db
            .update(tools)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(tools.id, id))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string) {
        await db.delete(tools).where(eq(tools.id, id));
    },

    async findByIds(ids: string[]) {
        if (ids.length === 0) return [];
        const results = [];
        for (const id of ids) {
            const tool = await this.findById(id);
            if (tool) results.push(tool);
        }
        return results;
    },
};
