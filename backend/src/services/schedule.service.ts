import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { NotFoundError, AppError } from "../lib/errors.ts";
import {
    registerJob,
    removeJob,
    pauseJob,
    resumeJob,
} from "../lib/scheduler.ts";

function validateCron(cron: string) {
    // Basic cron validation: 5 or 6 parts
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
        throw new AppError(
            "Invalid cron expression. Expected 5 or 6 fields.",
            400,
            "INVALID_CRON"
        );
    }
}

export const scheduleService = {
    async createSchedule(
        data: {
            name: string;
            cron: string;
            targetType: "task" | "workflow";
            targetId: string;
            enabled?: boolean;
        },
        workspaceId: string
    ) {
        validateCron(data.cron);
        const schedule = await scheduleRepository.create({
            ...data,
            workspaceId,
        });
        if (schedule.enabled) {
            await registerJob(schedule);
        }
        return schedule;
    },

    async getSchedules(workspaceId: string) {
        return scheduleRepository.findByWorkspace(workspaceId);
    },

    async getSchedule(id: string, workspaceId: string) {
        const schedule = await scheduleRepository.findById(id, workspaceId);
        if (!schedule) throw new NotFoundError("Schedule not found");
        return schedule;
    },

    async updateSchedule(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            cron: string;
            enabled: boolean;
        }>
    ) {
        const schedule = await scheduleRepository.findById(id, workspaceId);
        if (!schedule) throw new NotFoundError("Schedule not found");

        if (data.cron) validateCron(data.cron);

        const updated = await scheduleRepository.update(
            id,
            workspaceId,
            data
        );
        if (!updated) throw new NotFoundError("Schedule not found");

        // Handle cron/enabled changes
        if (data.enabled === false) {
            await pauseJob(id);
        } else if (data.enabled === true || data.cron) {
            await removeJob(id);
            if (updated.enabled) {
                await resumeJob(updated);
            }
        }

        return updated;
    },

    async deleteSchedule(id: string, workspaceId: string) {
        const schedule = await scheduleRepository.findById(id, workspaceId);
        if (!schedule) throw new NotFoundError("Schedule not found");
        await removeJob(id);
        await scheduleRepository.delete(id, workspaceId);
    },
};
