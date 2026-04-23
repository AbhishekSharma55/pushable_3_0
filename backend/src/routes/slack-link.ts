import type { FastifyInstance } from "fastify";
import { slackLinkService } from "../services/slack-link.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

export async function slackLinkRoutes(fastify: FastifyInstance) {
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

    // GET /slack/status — check if platform bot is available + list links
    fastify.get("/slack/status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const available = slackLinkService.isAvailable();
        const installUrl = await slackLinkService.getInstallUrl();
        const links = available
            ? await slackLinkService.getLinks(workspaceId)
            : [];

        return {
            data: {
                available,
                installUrl,
                links,
            },
        };
    });

    // POST /slack/link — initiate verification flow
    fastify.post("/slack/link", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };
        const result = await slackLinkService.initiateLink(
            workspaceId,
            user.userId
        );
        return reply.status(201).send({ data: result });
    });

    // GET /slack/link-status — poll to check if verification completed
    fastify.get("/slack/link-status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };
        const status = await slackLinkService.checkLinkStatus(
            workspaceId,
            user.userId
        );
        return { data: status };
    });

    // DELETE /slack/links/:id — unlink a Slack account
    fastify.delete("/slack/links/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await slackLinkService.unlinkUser(id, workspaceId);
        return reply.status(204).send();
    });
}
