import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { channelService } from "../services/channel.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createChannelSchema = z.object({
    agentId: z.string().uuid(),
    channelType: z.enum(["telegram", "slack"]),
    name: z.string().min(1, "Name is required"),
    credentials: z.record(z.string(), z.unknown()),
    config: z.record(z.string(), z.unknown()).optional(),
});

const updateChannelSchema = z.object({
    name: z.string().min(1).optional(),
    agentId: z.string().uuid().optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
});

export async function channelRoutes(fastify: FastifyInstance) {
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

    // GET /channels
    fastify.get("/channels", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        return { data: await channelService.getConnections(workspaceId) };
    });

    // POST /channels
    fastify.post("/channels", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createChannelSchema.parse(request.body);
        const connection = await channelService.createConnection(body, workspaceId);
        return reply.status(201).send({ data: connection });
    });

    // POST /channels/:id/test
    fastify.post("/channels/:id/test", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const result = await channelService.testConnection(id, workspaceId);
        return { data: result };
    });

    // PUT /channels/:id
    fastify.put("/channels/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateChannelSchema.parse(request.body);
        return { data: await channelService.updateConnection(id, workspaceId, body) };
    });

    // DELETE /channels/:id
    fastify.delete("/channels/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await channelService.deleteConnection(id, workspaceId);
        return reply.status(204).send();
    });
}
