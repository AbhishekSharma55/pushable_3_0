import { Queue } from "bullmq";
import { logger } from "./logger.ts";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

// Parse redis URL for connection options
function parseRedisUrl(url: string) {
    const parsed = new URL(url);
    return {
        host: parsed.hostname,
        port: Number(parsed.port) || 6379,
        password: parsed.password || undefined,
    };
}

const connection = parseRedisUrl(redisUrl);

export const taskQueue = new Queue("tasks", { connection });
export const workflowQueue = new Queue("workflows", { connection });

export function getQueue(name: string): Queue {
    if (name === "tasks") return taskQueue;
    if (name === "workflows") return workflowQueue;
    throw new Error(`Unknown queue: ${name}`);
}

export { connection as redisConnection };

logger.info({ host: connection.host, port: connection.port }, "Redis queues initialized");
