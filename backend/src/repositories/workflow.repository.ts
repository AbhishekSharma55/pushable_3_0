import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workflows, workflowSteps } from "../db/schema/index.ts";

export const workflowRepository = {
    async create(data: { workspaceId: string; name: string }) {
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
            .orderBy(workflows.createdAt);
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{ name: string }>
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

    async delete(id: string, workspaceId: string) {
        // Delete steps first, then workflow
        await db
            .delete(workflowSteps)
            .where(eq(workflowSteps.workflowId, id));
        await db
            .delete(workflows)
            .where(
                and(
                    eq(workflows.id, id),
                    eq(workflows.workspaceId, workspaceId)
                )
            );
    },

    async addStep(data: {
        workspaceId: string;
        workflowId: string;
        taskId: string;
        order: number;
    }) {
        const result = await db
            .insert(workflowSteps)
            .values(data)
            .returning();
        return result[0];
    },

    async getSteps(workflowId: string, workspaceId: string) {
        return db
            .select()
            .from(workflowSteps)
            .where(
                and(
                    eq(workflowSteps.workflowId, workflowId),
                    eq(workflowSteps.workspaceId, workspaceId)
                )
            )
            .orderBy(asc(workflowSteps.order));
    },

    async updateStepOrder(steps: { id: string; order: number }[]) {
        for (const step of steps) {
            await db
                .update(workflowSteps)
                .set({ order: step.order })
                .where(eq(workflowSteps.id, step.id));
        }
    },

    async deleteStep(id: string, workflowId: string) {
        await db
            .delete(workflowSteps)
            .where(
                and(
                    eq(workflowSteps.id, id),
                    eq(workflowSteps.workflowId, workflowId)
                )
            );
    },
};
