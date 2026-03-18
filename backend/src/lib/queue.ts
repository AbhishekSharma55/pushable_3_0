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

export const scheduleQueue = new Queue("schedules", { connection });

export { connection as redisConnection };

logger.info({ host: connection.host, port: connection.port }, "Redis queue initialized");
