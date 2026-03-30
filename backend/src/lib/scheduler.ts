import { scheduleQueue } from "./queue.ts";
import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { logger } from "./logger.ts";

// Track registered job keys for removal
const registeredJobs = new Map<string, string>();

export async function registerJob(schedule: {
    id: string;
    workspaceId: string;
    agentId: string;
    prompt: string;
    cron: string;
    timezone?: string;
}) {
    const payload = {
        scheduleId: schedule.id,
        agentId: schedule.agentId,
        prompt: schedule.prompt,
        workspaceId: schedule.workspaceId,
    };

    await scheduleQueue.add(`schedule-${schedule.id}`, payload, {
        repeat: {
            pattern: schedule.cron,
            tz: schedule.timezone || "UTC",
        },
        jobId: `schedule-${schedule.id}`,
    });

    registeredJobs.set(schedule.id, `schedule-${schedule.id}`);

    logger.info(
        { scheduleId: schedule.id, cron: schedule.cron, tz: schedule.timezone },
        "Scheduled job registered"
    );
}

export async function removeJob(scheduleId: string) {
    const key = registeredJobs.get(scheduleId);
    if (!key) return;

    const repeatableJobs = await scheduleQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === `schedule-${scheduleId}`) {
            await scheduleQueue.removeRepeatableByKey(job.key);
            break;
        }
    }

    registeredJobs.delete(scheduleId);
    logger.info({ scheduleId }, "Scheduled job removed");
}

export async function pauseJob(scheduleId: string) {
    await removeJob(scheduleId);
}

export async function resumeJob(schedule: {
    id: string;
    workspaceId: string;
    agentId: string;
    prompt: string;
    cron: string;
    timezone?: string;
}) {
    await registerJob(schedule);
}

export async function initScheduler() {
    try {
        const enabledSchedules = await scheduleRepository.findAllEnabled();
        logger.info(
            { count: enabledSchedules.length },
            "Loading enabled schedules"
        );

        for (const schedule of enabledSchedules) {
            try {
                await registerJob(schedule);
            } catch (error) {
                logger.error(
                    { scheduleId: schedule.id, error },
                    "Failed to register scheduled job"
                );
            }
        }

        logger.info("Scheduler initialized");
    } catch (error) {
        logger.error({ error }, "Failed to initialize scheduler");
    }
}
