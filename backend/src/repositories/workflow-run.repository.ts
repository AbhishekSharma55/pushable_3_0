import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workflowRuns } from "../db/schema/index.ts";

export const workflowRunRepository = {
    async create(data: {
        workflowId: string;
        workspaceId: string;
        inputData?: Record<string, unknown>;
    }) {
        const result = await db
            .insert(workflowRuns)
            .values({
                workflowId: data.workflowId,
                workspaceId: data.workspaceId,
                inputData: data.inputData ?? {},
                status: "running",
            })
            .returning();
        return result[0];
    },

    async updateCompleted(
        id: string,
        data: {
            resultText?: string;
            creditsUsed: number;
            durationMs: number;
            stepResults?: unknown[];
        }
    ) {
        await db
            .update(workflowRuns)
            .set({
                status: "completed",
                resultText: data.resultText,
                creditsUsed: data.creditsUsed,
                durationMs: data.durationMs,
                stepResults: data.stepResults ?? [],
                completedAt: new Date(),
            })
            .where(eq(workflowRuns.id, id));
    },

    async updateFailed(id: string, error: string, durationMs: number) {
        await db
            .update(workflowRuns)
            .set({
                status: "failed",
                error,
                durationMs,
                completedAt: new Date(),
            })
            .where(eq(workflowRuns.id, id));
    },

    async findByWorkflow(
        workflowId: string,
        workspaceId: string,
        limit: number,
        offset: number
    ) {
        return db
            .select()
            .from(workflowRuns)
            .where(
                and(
                    eq(workflowRuns.workflowId, workflowId),
                    eq(workflowRuns.workspaceId, workspaceId)
                )
            )
            .orderBy(desc(workflowRuns.startedAt))
            .limit(limit)
            .offset(offset);
    },

    async getStats(workflowId: string, workspaceId: string) {
        const result = await db
            .select({
                totalRuns: sql<number>`count(*)::int`,
                totalCredits: sql<number>`coalesce(sum(${workflowRuns.creditsUsed}), 0)::int`,
                successCount: sql<number>`count(*) filter (where ${workflowRuns.status} = 'completed')::int`,
                failCount: sql<number>`count(*) filter (where ${workflowRuns.status} = 'failed')::int`,
                avgDurationMs: sql<number>`coalesce(avg(${workflowRuns.durationMs}) filter (where ${workflowRuns.durationMs} is not null), 0)::int`,
            })
            .from(workflowRuns)
            .where(
                and(
                    eq(workflowRuns.workflowId, workflowId),
                    eq(workflowRuns.workspaceId, workspaceId)
                )
            );
        return result[0];
    },
};
