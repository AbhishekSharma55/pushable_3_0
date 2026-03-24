import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { integrationService } from "../services/integration.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const connectSchema = z.object({
    toolkitSlug: z.string().min(1),
    name: z.string().min(1),
    connectionLabel: z.string().min(2, "Connection name must be at least 2 characters"),
    connectionDescription: z.string().optional(),
    logo: z.string().optional(),
});

const toolPermissionsSchema = z.object({
    mode: z.enum(["allowlist", "blocklist"]),
    tools: z.array(z.string()),
});

const updateConnectionSchema = z.object({
    connectionLabel: z.string().min(2).optional(),
    connectionDescription: z.string().optional(),
});

export async function integrationRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    fastify.addHook("preHandler", async (request) => {
        // Skip workspace check for global toolkit listing
        if (request.url.startsWith("/api/integrations/toolkits")) return;
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // GET /integrations/toolkits
    fastify.get("/integrations/toolkits", async (request) => {
        const { search, cursor, limit } = request.query as {
            search?: string;
            cursor?: string;
            limit?: string;
        };
        const result = await integrationService.listToolkits({
            search,
            cursor,
            limit: limit ? Number(limit) : undefined,
        });
        return { data: result.items, nextCursor: result.nextCursor };
    });

    // GET /integrations
    fastify.get("/integrations", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        return {
            data: await integrationService.getIntegrations(workspaceId),
        };
    });

    // POST /integrations/connect
    fastify.post("/integrations/connect", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = connectSchema.parse(request.body);
        const frontendUrl =
            process.env.FRONTEND_URL || "https://platform.pushable.ai";
        const result = await integrationService.initiateConnection({
            workspaceId,
            toolkitSlug: body.toolkitSlug,
            name: body.name,
            connectionLabel: body.connectionLabel,
            connectionDescription: body.connectionDescription,
            logo: body.logo,
            redirectUrl: `${frontendUrl}/integrations/callback`,
        });
        return reply.status(201).send({ data: result });
    });

    // POST /integrations/callback
    fastify.post("/integrations/callback", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { connectedAccountId, status } = request.body as {
            connectedAccountId: string;
            status: string;
        };
        const result = await integrationService.handleCallback(
            workspaceId,
            connectedAccountId,
            status
        );
        return { data: result };
    });

    // GET /integrations/:id/status
    fastify.get("/integrations/:id/status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const result = await integrationService.pollConnectionStatus(
            id,
            workspaceId
        );
        return { data: result };
    });

    // PUT /integrations/:id
    fastify.put("/integrations/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateConnectionSchema.parse(request.body);
        const updated = await integrationService.updateConnection(
            id,
            workspaceId,
            body
        );
        return { data: updated };
    });

    // DELETE /integrations/:id
    fastify.delete("/integrations/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await integrationService.deleteIntegration(id, workspaceId);
        return reply.status(204).send();
    });

    // POST /agents/:agentId/integrations/:integrationId
    fastify.post(
        "/agents/:agentId/integrations/:integrationId",
        async (request, reply) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const { agentId, integrationId } = request.params as {
                agentId: string;
                integrationId: string;
            };
            await integrationService.assignToAgent(
                agentId,
                integrationId,
                workspaceId
            );
            return reply.status(201).send({ data: { assigned: true } });
        }
    );

    // DELETE /agents/:agentId/integrations/:integrationId
    fastify.delete(
        "/agents/:agentId/integrations/:integrationId",
        async (request, reply) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const { agentId, integrationId } = request.params as {
                agentId: string;
                integrationId: string;
            };
            await integrationService.removeFromAgent(
                agentId,
                integrationId,
                workspaceId
            );
            return reply.status(204).send();
        }
    );

    // GET /integrations/toolkits/:slug/actions
    fastify.get("/integrations/toolkits/:slug/actions", async (request) => {
        const { slug } = request.params as { slug: string };
        const actions = await integrationService.listToolkitActions(slug);
        return { data: actions };
    });

    // PUT /integrations/:id/permissions
    fastify.put("/integrations/:id/permissions", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = toolPermissionsSchema.parse(request.body);
        const updated = await integrationService.updateToolPermissions(
            id,
            workspaceId,
            body
        );
        return { data: updated };
    });

    // GET /agents/:agentId/integrations
    fastify.get("/agents/:agentId/integrations", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.params as { agentId: string };
        const integrations = await integrationService.getAgentIntegrations(
            agentId,
            workspaceId
        );
        return { data: integrations };
    });
}
