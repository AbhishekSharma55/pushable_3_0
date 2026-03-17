import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { schedules } from "../db/schema/index.ts";

export const scheduleRepository = {
    async create(data: {
        workspaceId: string;
        name: string;
        cron: string;
        targetType: "task" | "workflow";
        targetId: string;
        enabled?: boolean;
        naturalLanguage?: string;
        humanizeDelay?: number;
        timezone?: string;
        businessHoursOnly?: boolean;
        workStartHour?: number;
        workEndHour?: number;
        workDays?: number[];
        scheduleType?: "natural" | "preset" | "custom";
        presetKey?: string;
        nextRunDescription?: string;
    }) {
        const result = await db.insert(schedules).values(data).returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(schedules)
            .where(
                and(
                    eq(schedules.id, id),
                    eq(schedules.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(schedules)
            .where(eq(schedules.workspaceId, workspaceId))
            .orderBy(schedules.createdAt);
    },

    async findAllEnabled() {
        return db
            .select()
            .from(schedules)
            .where(eq(schedules.enabled, true));
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            cron: string;
            enabled: boolean;
            targetType: "task" | "workflow";
            targetId: string;
            nextRunDescription: string;
        }>
    ) {
        const result = await db
            .update(schedules)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(schedules.id, id),
                    eq(schedules.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async updateLastRunAt(id: string) {
        await db
            .update(schedules)
            .set({ lastRunAt: new Date() })
            .where(eq(schedules.id, id));
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(schedules)
            .where(
                and(
                    eq(schedules.id, id),
                    eq(schedules.workspaceId, workspaceId)
                )
            );
    },
};
