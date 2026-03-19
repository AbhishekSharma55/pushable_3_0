import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { scheduleRunRepository } from "../repositories/schedule-run.repository.ts";
import { NotFoundError, AppError } from "../lib/errors.ts";
import {
    registerJob,
    removeJob,
    pauseJob,
    resumeJob,
} from "../lib/scheduler.ts";
import { SCHEDULE_PRESETS } from "../lib/schedule-presets.ts";
import { convertNaturalLanguageToCron } from "../lib/nl-to-cron.ts";
import { CronExpressionParser } from "cron-parser";
import { toZonedTime, format } from "date-fns-tz";
import { logger } from "../lib/logger.ts";

function validateCron(cron: string) {
    try {
        CronExpressionParser.parse(cron);
    } catch {
        throw new AppError(
            "Invalid cron expression.",
            400,
            "INVALID_CRON"
        );
    }
}

function getNextRunDescription(cron: string, timezone: string): string {
    try {
        const interval = CronExpressionParser.parse(cron, { tz: timezone });
        const next = interval.next().toDate();
        const zoned = toZonedTime(next, timezone);
        return format(zoned, "EEE, MMM d 'at' h:mm a zzz", { timeZone: timezone });
    } catch {
        return "";
    }
}

function getNextRuns(cron: string, timezone: string, count: number): string[] {
    try {
        const interval = CronExpressionParser.parse(cron, { tz: timezone });
        const runs: string[] = [];
        for (let i = 0; i < count; i++) {
            const next = interval.next().toDate();
            const zoned = toZonedTime(next, timezone);
            runs.push(format(zoned, "EEE, MMM d 'at' h:mm a zzz", { timeZone: timezone }));
        }
        return runs;
    } catch {
        return [];
    }
}

export const scheduleService = {
    async createSchedule(
        data: {
            name: string;
            agentId: string;
            prompt: string;
            enabled?: boolean;
            scheduleType: "natural" | "preset" | "custom";
            naturalLanguage?: string;
            presetKey?: string;
            cronExpression?: string;
            timezone?: string;
            humanizeDelay?: number;
            businessHoursOnly?: boolean;
            workStartHour?: number;
            workEndHour?: number;
            workDays?: number[];
        },
        workspaceId: string
    ) {
        const timezone = data.timezone || "UTC";
        let cron: string;
        let humanReadable: string | undefined;
        let humanizeDelay = data.humanizeDelay ?? 0;

        if (data.scheduleType === "preset" && data.presetKey) {
            const preset = SCHEDULE_PRESETS.find((p) => p.key === data.presetKey);
            if (!preset || !preset.cron) {
                throw new AppError("Invalid preset", 400, "INVALID_PRESET");
            }
            cron = preset.cron;
            humanReadable = preset.label;
            if (data.humanizeDelay === undefined) {
                humanizeDelay = preset.humanizeDelay;
            }
        } else if (data.scheduleType === "natural" && data.naturalLanguage) {
            const result = await convertNaturalLanguageToCron(data.naturalLanguage, timezone);
            cron = result.cron;
            humanReadable = result.humanReadable;
        } else if (data.scheduleType === "custom" && data.cronExpression) {
            cron = data.cronExpression;
            validateCron(cron);
        } else {
            throw new AppError(
                "Invalid schedule configuration",
                400,
                "INVALID_SCHEDULE_CONFIG"
            );
        }

        const nextRunDescription = getNextRunDescription(cron, timezone);

        const schedule = await scheduleRepository.create({
            workspaceId,
            agentId: data.agentId,
            name: data.name,
            prompt: data.prompt,
            cron,
            enabled: data.enabled,
            naturalLanguage: data.naturalLanguage,
            humanizeDelay,
            timezone,
            businessHoursOnly: data.businessHoursOnly ?? false,
            workStartHour: data.workStartHour ?? 9,
            workEndHour: data.workEndHour ?? 18,
            workDays: data.workDays ?? [1, 2, 3, 4, 5],
            scheduleType: data.scheduleType,
            presetKey: data.presetKey,
            nextRunDescription,
        });

        if (schedule.enabled) {
            await registerJob({ ...schedule, timezone });
        }

        return { ...schedule, humanReadable };
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
            prompt: string;
            cron: string;
            enabled: boolean;
            humanizeDelay: number;
            businessHoursOnly: boolean;
            workStartHour: number;
            workEndHour: number;
            workDays: number[];
            timezone: string;
        }>
    ) {
        const schedule = await scheduleRepository.findById(id, workspaceId);
        if (!schedule) throw new NotFoundError("Schedule not found");

        if (data.cron) validateCron(data.cron);

        // Regenerate nextRunDescription when cron or timezone changes
        const updatePayload: typeof data & { nextRunDescription?: string } = { ...data };
        if (data.cron || data.timezone) {
            const cron = data.cron || schedule.cron;
            const timezone = data.timezone || schedule.timezone;
            updatePayload.nextRunDescription = getNextRunDescription(cron, timezone);
        }

        const updated = await scheduleRepository.update(
            id,
            workspaceId,
            updatePayload
        );
        if (!updated) throw new NotFoundError("Schedule not found");

        // Handle cron/enabled changes
        if (data.enabled === false) {
            await pauseJob(id);
        } else if (data.enabled === true || data.cron) {
            await removeJob(id);
            if (updated.enabled) {
                await resumeJob({ ...updated, timezone: updated.timezone });
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

    async getScheduleRuns(scheduleId: string, workspaceId: string, limit: number, offset: number) {
        const schedule = await scheduleRepository.findById(scheduleId, workspaceId);
        if (!schedule) throw new NotFoundError("Schedule not found");
        return scheduleRunRepository.findBySchedule(scheduleId, workspaceId, limit, offset);
    },

    async getScheduleStats(scheduleId: string, workspaceId: string) {
        const schedule = await scheduleRepository.findById(scheduleId, workspaceId);
        if (!schedule) throw new NotFoundError("Schedule not found");
        return scheduleRunRepository.getStats(scheduleId, workspaceId);
    },

    async previewSchedule(naturalLanguage: string, timezone: string) {
        const result = await convertNaturalLanguageToCron(naturalLanguage, timezone);
        const nextRuns = getNextRuns(result.cron, timezone, 5);
        return {
            cron: result.cron,
            humanReadable: result.humanReadable,
            nextRuns,
        };
    },

    /**
     * Called by worker before executing a scheduled job.
     * Returns true if execution should proceed, false if skipped.
     */
    async executeWithHumanization(scheduleId: string): Promise<boolean> {
        const schedules = await scheduleRepository.findAllEnabled();
        const schedule = schedules.find((s) => s.id === scheduleId);
        if (!schedule) return true; // Not found, let it run normally

        // Humanize delay
        if (schedule.humanizeDelay > 0) {
            const delay = Math.random() * schedule.humanizeDelay * 60 * 1000;
            logger.info(
                { scheduleId, delayMs: Math.round(delay) },
                "Humanize delay applied"
            );
            await new Promise((r) => setTimeout(r, delay));
        }

        // Business hours check
        if (schedule.businessHoursOnly) {
            const now = toZonedTime(new Date(), schedule.timezone);
            const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
            const hour = now.getHours();
            const workDays = schedule.workDays as number[];

            if (!workDays.includes(dayOfWeek)) {
                logger.info(
                    { scheduleId, dayOfWeek, workDays },
                    "Skipped — outside work days"
                );
                return false;
            }

            if (hour < schedule.workStartHour || hour >= schedule.workEndHour) {
                logger.info(
                    { scheduleId, hour, workStart: schedule.workStartHour, workEnd: schedule.workEndHour },
                    "Skipped — outside business hours"
                );
                return false;
            }
        }

        // Update nextRunDescription
        try {
            const nextDesc = getNextRunDescription(schedule.cron, schedule.timezone);
            await scheduleRepository.update(schedule.id, schedule.workspaceId, {
                nextRunDescription: nextDesc,
            });
        } catch {
            // Non-critical
        }

        return true;
    },
};
