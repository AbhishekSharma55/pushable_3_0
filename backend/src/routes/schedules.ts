import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { scheduleService } from "../services/schedule.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createScheduleSchema = z.object({
    name: z.string().min(1, "Name is required"),
    cron: z.string().min(1, "Cron expression is required"),
    targetType: z.enum(["task", "workflow"]),
    targetId: z.string().uuid(),
    enabled: z.boolean().default(true),
});

const updateScheduleSchema = z.object({
    name: z.string().min(1).optional(),
    cron: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
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
