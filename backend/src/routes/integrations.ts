import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { integrationService } from "../services/integration.service.ts";
import { integrationRepository } from "../repositories/integration.repository.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { getStore } from "../graphs/agent.graph.ts";
import { logger } from "../lib/logger.ts";

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

    // GET /integrations/:id/learnings — fetch tool learnings for an integration's toolkit
    fastify.get("/integrations/:id/learnings", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        // Look up the integration to get its toolkit slug
        const integration = await integrationRepository.findById(id, workspaceId);
        if (!integration) {
            throw new AppError("Integration not found", 404, "NOT_FOUND");
        }

        const store = await getStore();
        // Search across all tool_learnings namespaces for this workspace
        // and filter by toolkit slug prefix (e.g. "GMAIL_" for gmail toolkit)
        const toolkitSlug = integration.composioToolkitSlug.toUpperCase();

        try {
            // List all tool_learnings namespaces for this workspace
            const namespaces = await store.listNamespaces({
                prefix: [workspaceId, "tool_learnings"],
                limit: 100,
            });

            const learnings: Array<{
                key: string;
                tool: string;
                learning: string;
                extractedAt: string;
                sourceAgentId?: string;
            }> = [];

            // Search each namespace that matches the toolkit prefix
            for (const ns of namespaces) {
                const toolName = ns[ns.length - 1];
                // Match tools belonging to this integration's toolkit
                // e.g. toolkit "gmail" matches tools like "GMAIL_SEND_EMAIL", "GMAIL_LIST_EMAILS"
                // Also include exact Composio meta-tools if they reference this toolkit
                const toolUpper = toolName.toUpperCase();
                if (
                    toolUpper.startsWith(toolkitSlug + "_") ||
                    toolUpper === toolkitSlug ||
                    toolUpper === `COMPOSIO_${toolkitSlug}`
                ) {
                    const items = await store.search(ns, { limit: 50 });
                    for (const item of items) {
                        learnings.push({
                            key: `${ns.join("/")}/${item.key}`,
                            tool: toolName,
                            learning: item.value.learning as string,
                            extractedAt: (item.value.extractedAt as string) || "",
                            sourceAgentId: item.value.sourceAgentId as string | undefined,
                        });
                    }
                }
            }

            // Also check COMPOSIO_MULTI_EXECUTE_TOOL learnings that mention this toolkit
            try {
                const composioNs = [workspaceId, "tool_learnings", "COMPOSIO_MULTI_EXECUTE_TOOL"];
                const composioItems = await store.search(composioNs, { limit: 50 });
                for (const item of composioItems) {
                    const learning = (item.value.learning as string) || "";
                    if (learning.toUpperCase().includes(toolkitSlug)) {
                        learnings.push({
                            key: `${composioNs.join("/")}/${item.key}`,
                            tool: "COMPOSIO_MULTI_EXECUTE_TOOL",
                            learning,
                            extractedAt: (item.value.extractedAt as string) || "",
                            sourceAgentId: item.value.sourceAgentId as string | undefined,
                        });
                    }
                }
            } catch {
                // Non-fatal — namespace may not exist yet
            }

            return { data: learnings };
        } catch (error) {
            logger.warn({ error, id, workspaceId }, "Failed to fetch tool learnings");
            return { data: [] };
        }
    });

    // DELETE /integrations/learnings/:key — delete a specific tool learning
    fastify.delete("/integrations/learnings", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { key } = request.query as { key: string };

        if (!key) {
            throw new AppError("key query parameter is required", 400, "MISSING_KEY");
        }

        // Parse the key back into namespace + item key
        // Format: "workspaceId/tool_learnings/TOOL_NAME/uuid"
        const parts = key.split("/");
        if (parts.length < 4 || parts[0] !== workspaceId) {
            throw new AppError("Invalid learning key", 400, "INVALID_KEY");
        }

        const namespace = parts.slice(0, -1);
        const itemKey = parts[parts.length - 1];

        try {
            const store = await getStore();
            await store.delete(namespace, itemKey);
            return reply.status(204).send();
        } catch (error) {
            logger.warn({ error, key, workspaceId }, "Failed to delete tool learning");
            throw new AppError("Failed to delete learning", 500, "DELETE_FAILED");
        }
    });
}
