import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { scheduleService } from "../services/schedule.service.ts";
import { SCHEDULE_PRESETS } from "../lib/schedule-presets.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createScheduleSchema = z.object({
    name: z.string().min(1, "Name is required"),
    targetType: z.enum(["task", "workflow"]),
    targetId: z.string().uuid(),
    enabled: z.boolean().default(true),
    scheduleType: z.enum(["natural", "preset", "custom"]),
    naturalLanguage: z.string().optional(),
    presetKey: z.string().optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().default("UTC"),
    humanizeDelay: z.number().int().min(0).max(30).optional(),
    businessHoursOnly: z.boolean().optional(),
    workStartHour: z.number().int().min(0).max(23).optional(),
    workEndHour: z.number().int().min(0).max(23).optional(),
    workDays: z.array(z.number().int().min(0).max(6)).optional(),
});

const updateScheduleSchema = z.object({
    name: z.string().min(1).optional(),
    cron: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
});

const previewSchema = z.object({
    naturalLanguage: z.string().min(1, "Description is required"),
    timezone: z.string().default("UTC"),
});

export async function scheduleRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        }
    });

    // GET /schedules/presets
    fastify.get("/schedules/presets", async () => {
        return { data: SCHEDULE_PRESETS };
    });

    // POST /schedules/preview
    fastify.post("/schedules/preview", async (request) => {
        const body = previewSchema.parse(request.body);
        const result = await scheduleService.previewSchedule(
            body.naturalLanguage,
            body.timezone
        );
        return { data: result };
    });

    fastify.get("/schedules", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        return { data: await scheduleService.getSchedules(workspaceId) };
    });

    fastify.post("/schedules", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createScheduleSchema.parse(request.body);
        const schedule = await scheduleService.createSchedule(body, workspaceId);
        return reply.status(201).send({ data: schedule });
    });

    fastify.get("/schedules/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        return { data: await scheduleService.getSchedule(id, workspaceId) };
    });

    fastify.put("/schedules/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateScheduleSchema.parse(request.body);
        return { data: await scheduleService.updateSchedule(id, workspaceId, body) };
    });

    fastify.delete("/schedules/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await scheduleService.deleteSchedule(id, workspaceId);
        return reply.status(204).send();
    });
}
