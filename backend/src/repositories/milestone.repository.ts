import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { projectMilestones } from "../db/schema/index.ts";

export const milestoneRepository = {
    async create(data: {
        projectId: string;
        workspaceId: string;
        title: string;
        description?: string;
        targetDate?: Date;
        sortOrder?: number;
    }) {
        const result = await db
            .insert(projectMilestones)
            .values({
                projectId: data.projectId,
                workspaceId: data.workspaceId,
                title: data.title,
                description: data.description || null,
                targetDate: data.targetDate || null,
                sortOrder: data.sortOrder ?? 0,
            })
            .returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(projectMilestones)
            .where(
                and(
                    eq(projectMilestones.id, id),
                    eq(projectMilestones.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByProject(projectId: string, workspaceId: string) {
        return db
            .select()
            .from(projectMilestones)
            .where(
                and(
                    eq(projectMilestones.projectId, projectId),
                    eq(projectMilestones.workspaceId, workspaceId)
                )
            )
            .orderBy(projectMilestones.sortOrder);
    },

    async update(id: string, workspaceId: string, data: Partial<{
        title: string;
        description: string;
        status: string;
        targetDate: Date;
        completedAt: Date;
        evaluationNotes: string;
        sortOrder: number;
    }>) {
        const result = await db
            .update(projectMilestones)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(projectMilestones.id, id),
                    eq(projectMilestones.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        const result = await db
            .delete(projectMilestones)
            .where(
                and(
                    eq(projectMilestones.id, id),
                    eq(projectMilestones.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },
};
