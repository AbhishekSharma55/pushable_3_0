import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionService } from "../services/session.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createSessionSchema = z.object({
    title: z.string().min(1, "Title is required"),
});

export async function sessionRoutes(fastify: FastifyInstance) {
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

    // GET /agents/:agentId/sessions
    fastify.get("/agents/:agentId/sessions", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.params as { agentId: string };
        const sessions = await sessionService.getSessions(
            agentId,
            workspaceId
        );
        return { data: sessions };
    });

    // POST /agents/:agentId/sessions
    fastify.post("/agents/:agentId/sessions", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.params as { agentId: string };
        const body = createSessionSchema.parse(request.body);
        const session = await sessionService.createSession(
            { agentId, title: body.title },
            workspaceId
        );
        return reply.status(201).send({ data: session });
    });

    // DELETE /agents/:agentId/sessions/:id
    fastify.delete("/agents/:agentId/sessions/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { agentId: string; id: string };
        await sessionService.deleteSession(id, workspaceId);
        return reply.status(204).send();
    });

    // GET /sessions/:id/messages
    fastify.get("/sessions/:id/messages", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const messages = await sessionService.getMessages(id, workspaceId);
        return { data: messages };
    });
}
