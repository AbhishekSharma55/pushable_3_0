import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { workflowService } from "../services/workflow.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createWorkflowSchema = z.object({
    agentId: z.string().uuid(),
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.object({
        type: z.enum(["string", "number", "boolean"]),
        description: z.string(),
        required: z.boolean().optional(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })).optional(),
    recipe: z.object({
        version: z.literal(1),
        steps: z.array(z.object({
            id: z.string(),
            type: z.enum(["tool", "nano_llm"]),
            tool: z.string().optional(),
            prompt: z.string().optional(),
            args: z.record(z.string(), z.unknown()).optional(),
            outputKey: z.string(),
            condition: z.string().optional(),
            fallbackToAgent: z.boolean().optional(),
            continueOnError: z.boolean().optional(),
            description: z.string().optional(),
        })),
        outputTemplate: z.string().optional(),
    }).optional(),
    sourceSessionId: z.string().uuid().optional(),
    enabled: z.boolean().optional(),
});

const updateWorkflowSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.object({
        type: z.enum(["string", "number", "boolean"]),
        description: z.string(),
        required: z.boolean().optional(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })).optional(),
    recipe: z.object({
        version: z.literal(1),
        steps: z.array(z.object({
            id: z.string(),
            type: z.enum(["tool", "nano_llm"]),
            tool: z.string().optional(),
            prompt: z.string().optional(),
            args: z.record(z.string(), z.unknown()).optional(),
            outputKey: z.string(),
            condition: z.string().optional(),
            fallbackToAgent: z.boolean().optional(),
            continueOnError: z.boolean().optional(),
            description: z.string().optional(),
        })),
        outputTemplate: z.string().optional(),
    }).optional(),
    enabled: z.boolean().optional(),
});

const compileWorkflowSchema = z.object({
    sessionId: z.string().uuid(),
    agentId: z.string().uuid(),
    userHint: z.string().optional(),
});

const runWorkflowSchema = z.object({
    inputData: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function workflowRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // GET /workflows
    fastify.get("/workflows", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        return { data: await workflowService.getWorkflows(workspaceId) };
    });

    // POST /workflows
    fastify.post("/workflows", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const body = createWorkflowSchema.parse(request.body);
        const workflow = await workflowService.createWorkflow(body, workspaceId);
        return reply.status(201).send({ data: workflow });
    });

    // POST /workflows/compile
    fastify.post("/workflows/compile", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const body = compileWorkflowSchema.parse(request.body);
        const workflow = await workflowService.compileFromSession(
            body.sessionId,
            body.agentId,
            workspaceId,
            body.userHint
        );
        return reply.status(201).send({ data: workflow });
    });

    // GET /workflows/:id
    fastify.get("/workflows/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const { id } = request.params as { id: string };
        return { data: await workflowService.getWorkflow(id, workspaceId) };
    });

    // PUT /workflows/:id
    fastify.put("/workflows/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const { id } = request.params as { id: string };
        const body = updateWorkflowSchema.parse(request.body);
        return { data: await workflowService.updateWorkflow(id, workspaceId, body) };
    });

    // DELETE /workflows/:id
    fastify.delete("/workflows/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const { id } = request.params as { id: string };
        await workflowService.deleteWorkflow(id, workspaceId);
        return reply.status(204).send();
    });

    // POST /workflows/:id/run
    fastify.post("/workflows/:id/run", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const { id } = request.params as { id: string };
        const body = runWorkflowSchema.parse(request.body);
        const result = await workflowService.runWorkflow(id, workspaceId, body.inputData as Record<string, unknown>);
        return { data: result };
    });

    // GET /workflows/:id/runs
    fastify.get("/workflows/:id/runs", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const { id } = request.params as { id: string };
        const { limit = "50", offset = "0" } = request.query as Record<string, string>;
        const runs = await workflowService.getWorkflowRuns(
            id,
            workspaceId,
            Math.min(parseInt(limit, 10) || 50, 100),
            parseInt(offset, 10) || 0
        );
        return { data: runs };
    });

    // GET /workflows/:id/stats
    fastify.get("/workflows/:id/stats", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        const { id } = request.params as { id: string };
        const stats = await workflowService.getWorkflowStats(id, workspaceId);
        return { data: stats };
    });
}
