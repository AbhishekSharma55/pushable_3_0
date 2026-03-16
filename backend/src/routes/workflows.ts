import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { workflowService } from "../services/workflow.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createWorkflowSchema = z.object({
    name: z.string().min(1, "Name is required"),
});

const updateWorkflowSchema = z.object({
    name: z.string().min(1).optional(),
});

const addStepSchema = z.object({
    taskId: z.string().uuid(),
});

const reorderStepsSchema = z.object({
    steps: z.array(
        z.object({
            id: z.string().uuid(),
            order: z.number().int().min(0),
        })
    ),
});

export async function workflowRoutes(fastify: FastifyInstance) {
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

    fastify.get("/workflows", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        return { data: await workflowService.getWorkflows(workspaceId) };
    });

    fastify.post("/workflows", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createWorkflowSchema.parse(request.body);
        const workflow = await workflowService.createWorkflow(body, workspaceId);
        return reply.status(201).send({ data: workflow });
    });

    fastify.get("/workflows/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        return { data: await workflowService.getWorkflow(id, workspaceId) };
    });

    fastify.put("/workflows/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateWorkflowSchema.parse(request.body);
        return { data: await workflowService.updateWorkflow(id, workspaceId, body) };
    });

    fastify.delete("/workflows/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await workflowService.deleteWorkflow(id, workspaceId);
        return reply.status(204).send();
    });

    fastify.post("/workflows/:id/steps", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = addStepSchema.parse(request.body);
        const step = await workflowService.addStep(id, body.taskId, workspaceId);
        return reply.status(201).send({ data: step });
    });

    fastify.delete("/workflows/:id/steps/:stepId", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id, stepId } = request.params as { id: string; stepId: string };
        await workflowService.removeStep(stepId, id, workspaceId);
        return reply.status(204).send();
    });

    fastify.put("/workflows/:id/steps/reorder", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = reorderStepsSchema.parse(request.body);
        await workflowService.reorderSteps(id, workspaceId, body.steps);
        return { data: { success: true } };
    });

    fastify.post("/workflows/:id/run", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await workflowService.runWorkflow(id, workspaceId);
        return reply.status(202).send({ data: { queued: true } });
    });
}
