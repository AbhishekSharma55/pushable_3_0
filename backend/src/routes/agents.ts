import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentService } from "../services/agent.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { invalidateGraphCache } from "../graphs/agent.graph.ts";

const createAgentSchema = z.object({
    name: z.string().min(1, "Name is required"),
    systemPrompt: z.string().optional(),
    model: z.string().default("gpt-4o-mini"),
    temperature: z.number().min(0).max(2).default(0.7),
    browserType: z.enum(["cloud", "extension"]).default("cloud"),
});

const updateAgentSchema = z.object({
    name: z.string().min(1).optional(),
    systemPrompt: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    browserType: z.enum(["cloud", "extension"]).optional(),
    browserProxyId: z.string().uuid().nullable().optional(),
});

const systemPermissionsSchema = z.object({
    systemLevelAccess: z.boolean(),
    canManageKB: z.boolean(),
    canManageSkills: z.boolean(),
    canManageTools: z.boolean(),
    canManageSchedules: z.boolean(),
    canManageChannels: z.boolean(),
    canManageAgents: z.boolean(),
});

export async function agentRoutes(fastify: FastifyInstance) {
    // Auth preHandler for all routes
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Validate x-workspace-id header
    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // GET /agents
    fastify.get("/agents", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const agents = await agentService.getAgents(workspaceId);
        return { data: agents };
    });

    // POST /agents
    fastify.post("/agents", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createAgentSchema.parse(request.body);
        const agent = await agentService.createAgent(body, workspaceId);
        return reply.status(201).send({ data: agent });
    });

    // GET /agents/:id
    fastify.get("/agents/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const agent = await agentService.getAgent(id, workspaceId);
        return { data: agent };
    });

    // PUT /agents/:id
    fastify.put("/agents/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateAgentSchema.parse(request.body);
        const agent = await agentService.updateAgent(id, workspaceId, body);
        invalidateGraphCache(id, workspaceId);
        return { data: agent };
    });

    // DELETE /agents/:id
    fastify.delete("/agents/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await agentService.deleteAgent(id, workspaceId);
        invalidateGraphCache(id, workspaceId);
        return reply.status(204).send();
    });

    // PUT /agents/:id/system-permissions
    fastify.put("/agents/:id/system-permissions", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = systemPermissionsSchema.parse(request.body);
        invalidateGraphCache(id, workspaceId);
        const agent = await agentService.updateSystemPermissions(
            id,
            workspaceId,
            body
        );
        return { data: agent };
    });
}
