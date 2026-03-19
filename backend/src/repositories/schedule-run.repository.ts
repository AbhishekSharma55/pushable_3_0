import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { scheduleRuns } from "../db/schema/index.ts";

export const scheduleRunRepository = {
    async create(data: { scheduleId: string; workspaceId: string }) {
        const result = await db
            .insert(scheduleRuns)
            .values({
                scheduleId: data.scheduleId,
                workspaceId: data.workspaceId,
                status: "running",
            })
            .returning();
        return result[0];
    },

    async updateCompleted(
        id: string,
        data: { resultText?: string; creditsUsed: number; durationMs: number }
    ) {
        await db
            .update(scheduleRuns)
            .set({
                status: "completed",
                resultText: data.resultText,
                creditsUsed: data.creditsUsed,
                durationMs: data.durationMs,
                completedAt: new Date(),
            })
            .where(eq(scheduleRuns.id, id));
    },

    async updateFailed(id: string, error: string, durationMs: number) {
        await db
            .update(scheduleRuns)
            .set({
                status: "failed",
                error,
                durationMs,
                completedAt: new Date(),
            })
            .where(eq(scheduleRuns.id, id));
    },

    async updateSkipped(id: string) {
        await db
            .update(scheduleRuns)
            .set({
                status: "skipped",
                completedAt: new Date(),
            })
            .where(eq(scheduleRuns.id, id));
    },

    async findBySchedule(
        scheduleId: string,
        workspaceId: string,
        limit: number,
        offset: number
    ) {
        return db
            .select()
            .from(scheduleRuns)
            .where(
                and(
                    eq(scheduleRuns.scheduleId, scheduleId),
                    eq(scheduleRuns.workspaceId, workspaceId)
                )
            )
            .orderBy(desc(scheduleRuns.startedAt))
            .limit(limit)
            .offset(offset);
    },

    async getStats(scheduleId: string, workspaceId: string) {
        const result = await db
            .select({
                totalRuns: sql<number>`count(*)::int`,
                totalCredits: sql<number>`coalesce(sum(${scheduleRuns.creditsUsed}), 0)::int`,
                successCount: sql<number>`count(*) filter (where ${scheduleRuns.status} = 'completed')::int`,
                failCount: sql<number>`count(*) filter (where ${scheduleRuns.status} = 'failed')::int`,
                avgDurationMs: sql<number>`coalesce(avg(${scheduleRuns.durationMs}) filter (where ${scheduleRuns.durationMs} is not null), 0)::int`,
            })
            .from(scheduleRuns)
            .where(
                and(
                    eq(scheduleRuns.scheduleId, scheduleId),
                    eq(scheduleRuns.workspaceId, workspaceId)
                )
            );
        return result[0];
    },
};
