import type { FastifyInstance, FastifyRequest } from "fastify";
import { workspaceRepository } from "../repositories/workspace.repository.ts";

export async function internalRoutes(fastify: FastifyInstance) {
    // GET /internal/extension/validate-key?key=XXX
    // Used by the extension-bridge service to validate per-workspace API keys
    fastify.get("/extension/validate-key", async (request, reply) => {
        const query = request.query as { key?: string };
        const apiKey = query.key;

        if (!apiKey) {
            return reply.status(400).send({ error: "Missing API key" });
        }

        const workspace = await workspaceRepository.findByExtensionApiKey(apiKey);
        if (!workspace) {
            return reply.status(401).send({ error: "Invalid API key", valid: false });
        }

        return { valid: true, workspaceId: workspace.id };
    });
}
