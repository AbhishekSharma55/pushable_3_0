import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { skills } from "../db/schema/index.ts";

export const skillRepository = {
    async create(data: {
        workspaceId: string;
        name: string;
        description?: string;
        origin?: string;
        instructions: string;
    }) {
        const result = await db.insert(skills).values(data).returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(skills)
            .where(
                and(eq(skills.id, id), eq(skills.workspaceId, workspaceId))
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(skills)
            .where(eq(skills.workspaceId, workspaceId))
            .orderBy(skills.createdAt);
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{ name: string; description: string; origin: string; instructions: string }>
    ) {
        const result = await db
            .update(skills)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(eq(skills.id, id), eq(skills.workspaceId, workspaceId))
            )
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(skills)
            .where(
                and(eq(skills.id, id), eq(skills.workspaceId, workspaceId))
            );
    },

    async findByIds(ids: string[], workspaceId: string) {
        if (ids.length === 0) return [];
        const results = [];
        for (const id of ids) {
            const skill = await this.findById(id, workspaceId);
            if (skill) results.push(skill);
        }
        return results;
    },
};
