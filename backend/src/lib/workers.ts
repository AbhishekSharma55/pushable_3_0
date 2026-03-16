import { Worker } from "bullmq";
import { redisConnection } from "./queue.ts";
import { processTask } from "../processors/task.processor.ts";
import { processWorkflow } from "../processors/workflow.processor.ts";
import { logger } from "./logger.ts";

let taskWorker: Worker | null = null;
let workflowWorker: Worker | null = null;

export function startWorkers() {
    const connection = { ...redisConnection };

    taskWorker = new Worker(
        "tasks",
        async (job) => {
            await processTask(job.data);
        },
        { connection, concurrency: 1 }
    );

    taskWorker.on("completed", (job) => {
        logger.info({ jobId: job.id }, "Task job completed");
    });
    taskWorker.on("failed", (job, err) => {
        logger.error({ jobId: job?.id, err }, "Task job failed");
    });

    workflowWorker = new Worker(
        "workflows",
        async (job) => {
            await processWorkflow(job.data);
        },
        { connection, concurrency: 1 }
    );

    workflowWorker.on("completed", (job) => {
        logger.info({ jobId: job.id }, "Workflow job completed");
    });
    workflowWorker.on("failed", (job, err) => {
        logger.error({ jobId: job?.id, err }, "Workflow job failed");
    });

    logger.info("Workers started");
}

export async function stopWorkers() {
    if (taskWorker) await taskWorker.close();
    if (workflowWorker) await workflowWorker.close();
    logger.info("Workers stopped");
}
