import type { FastifyInstance } from "fastify";
import { telegramLinkService } from "../services/telegram-link.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

export async function telegramLinkRoutes(fastify: FastifyInstance) {
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
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // GET /telegram/status — check if platform bot is available + list links
    fastify.get("/telegram/status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const available = telegramLinkService.isAvailable();
        const botUsername = telegramLinkService.getBotUsername();
        const links = available
            ? await telegramLinkService.getLinks(workspaceId)
            : [];

        return {
            data: {
                available,
                botUsername,
                links,
            },
        };
    });

    // POST /telegram/link — initiate verification flow
    fastify.post("/telegram/link", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };
        const result = await telegramLinkService.initiateLink(
            workspaceId,
            user.userId
        );
        return reply.status(201).send({ data: result });
    });

    // GET /telegram/link-status — poll to check if verification completed
    fastify.get("/telegram/link-status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };
        const status = await telegramLinkService.checkLinkStatus(
            workspaceId,
            user.userId
        );
        return { data: status };
    });

    // DELETE /telegram/links/:id — unlink a Telegram account
    fastify.delete("/telegram/links/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await telegramLinkService.unlinkUser(id, workspaceId);
        return reply.status(204).send();
    });
}
