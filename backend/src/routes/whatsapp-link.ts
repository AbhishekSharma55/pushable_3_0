import type { FastifyInstance } from "fastify";
import { whatsappLinkService } from "../services/whatsapp-link.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

export async function whatsappLinkRoutes(fastify: FastifyInstance) {
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

    // GET /whatsapp/status — check if platform bot is available + list links
    fastify.get("/whatsapp/status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const available = whatsappLinkService.isAvailable();
        const links = available
            ? await whatsappLinkService.getLinks(workspaceId)
            : [];

        return {
            data: {
                available,
                links,
            },
        };
    });

    // POST /whatsapp/link — initiate verification flow
    fastify.post("/whatsapp/link", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };
        const result = await whatsappLinkService.initiateLink(
            workspaceId,
            user.userId
        );
        return reply.status(201).send({ data: result });
    });

    // GET /whatsapp/link-status — poll to check if verification completed
    fastify.get("/whatsapp/link-status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };
        const status = await whatsappLinkService.checkLinkStatus(
            workspaceId,
            user.userId
        );
        return { data: status };
    });

    // DELETE /whatsapp/links/:id — unlink a WhatsApp account
    fastify.delete("/whatsapp/links/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await whatsappLinkService.unlinkUser(id, workspaceId);
        return reply.status(204).send();
    });
}
