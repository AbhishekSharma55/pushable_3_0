import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { taskService } from "../services/task.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createTaskSchema = z.object({
    agentId: z.string().uuid(),
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
});

const updateTaskSchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    agentId: z.string().uuid().optional(),
});

export async function taskRoutes(fastify: FastifyInstance) {
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

    fastify.get("/tasks", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        return { data: await taskService.getTasks(workspaceId) };
    });

    fastify.post("/tasks", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createTaskSchema.parse(request.body);
        const task = await taskService.createTask(body, workspaceId);
        return reply.status(201).send({ data: task });
    });

    fastify.get("/tasks/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        return { data: await taskService.getTask(id, workspaceId) };
    });

    fastify.put("/tasks/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateTaskSchema.parse(request.body);
        return { data: await taskService.updateTask(id, workspaceId, body) };
    });

    fastify.delete("/tasks/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await taskService.deleteTask(id, workspaceId);
        return reply.status(204).send();
    });

    fastify.post("/tasks/:id/run", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await taskService.runTask(id, workspaceId);
        return reply.status(202).send({ data: { queued: true } });
    });
}
