import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionService } from "../services/session.service.ts";
import { browserRepository } from "../repositories/browser.repository.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { userAgentAccessRepository } from "../repositories/userAgentAccess.repository.ts";

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
        const user = request.user as { userId: string };

        // Check if user has access to this agent
        const isOwnerOrAdmin = await workspaceRepository.isOwnerOrAdmin(workspaceId, user.userId);
        if (!isOwnerOrAdmin) {
            const canAccess = await userAgentAccessRepository.isAgentAllowed(
                workspaceId,
                user.userId,
                agentId
            );
            if (!canAccess) {
                throw new AppError(
                    "You do not have access to this agent. Contact your workspace administrator.",
                    403,
                    "AGENT_ACCESS_DENIED"
                );
            }
        }

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

    // GET /sessions — list all sessions in workspace
    fastify.get("/sessions", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const sessions = await sessionService.getAllSessions(workspaceId);
        return { data: sessions };
    });

    // GET /sessions/:id/messages
    fastify.get("/sessions/:id/messages", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const messages = await sessionService.getMessages(id, workspaceId);
        return { data: messages };
    });

    // GET /sessions/:id/browser-session — returns active browser session for a chat session
    fastify.get("/sessions/:id/browser-session", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id: chatSessionId } = request.params as { id: string };

        try {
            // Get the chat session to find the agent
            const session = await sessionService.getSession(chatSessionId, workspaceId);

            // Find browser profile for this agent
            const profile = await browserRepository.findProfileByAgentId(
                session.agentId,
                workspaceId
            );
            if (!profile) {
                return { data: null };
            }

            // Try to find browser session scoped to this chat session
            let browserSession = await browserRepository.findActiveSessionByChatSession(
                profile.id,
                chatSessionId
            );

            // Fallback: find ANY active session for this profile
            if (!browserSession) {
                browserSession = await browserRepository.findActiveSessionByProfileId(
                    profile.id
                );
            }

            if (!browserSession) {
                return { data: null };
            }

            // Return just the session ID — frontend constructs the WS URL
            return {
                data: {
                    sessionId: browserSession.id,
                    status: browserSession.status,
                },
            };
        } catch (error) {
            logger.warn({ error, chatSessionId }, "Failed to look up browser session");
            return { data: null };
        }
    });
}
