import { taskQueue, workflowQueue } from "./queue.ts";
import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { logger } from "./logger.ts";

// Track registered job keys for removal
const registeredJobs = new Map<string, { queue: string; key: string }>();

export async function registerJob(schedule: {
    id: string;
    workspaceId: string;
    cron: string;
    targetType: "task" | "workflow";
    targetId: string;
}) {
    const queue =
        schedule.targetType === "task" ? taskQueue : workflowQueue;
    const payload =
        schedule.targetType === "task"
            ? { taskId: schedule.targetId, workspaceId: schedule.workspaceId }
            : {
                workflowId: schedule.targetId,
                workspaceId: schedule.workspaceId,
            };

    await queue.add(`schedule-${schedule.id}`, payload, {
        repeat: {
            pattern: schedule.cron,
        },
        jobId: `schedule-${schedule.id}`,
    });

    registeredJobs.set(schedule.id, {
        queue: schedule.targetType === "task" ? "tasks" : "workflows",
        key: `schedule-${schedule.id}`,
    });

    logger.info(
        { scheduleId: schedule.id, cron: schedule.cron },
        "Scheduled job registered"
    );
}

export async function removeJob(scheduleId: string) {
    const info = registeredJobs.get(scheduleId);
    if (!info) return;

    const queue = info.queue === "tasks" ? taskQueue : workflowQueue;

    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === `schedule-${scheduleId}`) {
            await queue.removeRepeatableByKey(job.key);
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
    cron: string;
    targetType: "task" | "workflow";
    targetId: string;
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
