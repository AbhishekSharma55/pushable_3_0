import { Worker } from "bullmq";
import { redisConnection } from "./queue.ts";
import { processSchedule } from "../processors/schedule.processor.ts";
import { logger } from "./logger.ts";

let scheduleWorker: Worker | null = null;

export function startWorkers() {
    const connection = { ...redisConnection };

    scheduleWorker = new Worker(
        "schedules",
        async (job) => {
            await processSchedule(job.data);
        },
        { connection, concurrency: 1 }
    );

    scheduleWorker.on("completed", (job) => {
        logger.info({ jobId: job.id }, "Schedule job completed");
    });
    scheduleWorker.on("failed", (job, err) => {
        logger.error({ jobId: job?.id, err }, "Schedule job failed");
    });

    logger.info("Workers started");
}

export async function stopWorkers() {
    if (scheduleWorker) await scheduleWorker.close();
    logger.info("Workers stopped");
}
