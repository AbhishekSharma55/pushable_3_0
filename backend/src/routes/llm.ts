import type { FastifyInstance } from "fastify";
import { openrouterService } from "../services/openrouter.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export async function llmRoutes(fastify: FastifyInstance) {
    // Auth preHandler for all routes
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    /**
     * GET /llm/models
     * Returns all available models from OpenRouter
     */
    fastify.get("/llm/models", async () => {
        try {
            const models = await openrouterService.getModels();
            return { data: models };
        } catch (error) {
            logger.error({ err: error }, "Failed to fetch models");
            throw new AppError(
                "Failed to fetch available models",
                502,
                "LLM_FETCH_ERROR"
            );
        }
    });

    /**
     * GET /llm/providers
     * Returns models grouped by provider
     */
    fastify.get("/llm/providers", async () => {
        try {
            const providers = await openrouterService.getModelsByProvider();
            return { data: providers };
        } catch (error) {
            logger.error({ err: error }, "Failed to fetch providers");
            throw new AppError(
                "Failed to fetch available providers",
                502,
                "LLM_FETCH_ERROR"
            );
        }
    });

    /**
     * GET /llm/models/search?q=<query>
     * Search models by name or ID
     */
    fastify.get("/llm/models/search", async (request) => {
        const { q } = request.query as { q?: string };
        if (!q || q.trim().length === 0) {
            throw new AppError(
                "Query parameter 'q' is required",
                400,
                "MISSING_QUERY"
            );
        }

        try {
            const models = await openrouterService.searchModels(q.trim());
            return { data: models };
        } catch (error) {
            logger.error({ err: error }, "Failed to search models");
            throw new AppError(
                "Failed to search models",
                502,
                "LLM_FETCH_ERROR"
            );
        }
    });

    /**
     * GET /llm/models/:modelId/capabilities
     * Returns model capabilities (vision support, input modalities)
     */
    fastify.get("/llm/models/:modelId/capabilities", async (request) => {
        const { modelId } = request.params as { modelId: string };

        try {
            const capabilities = await openrouterService.getModelCapabilities(
                decodeURIComponent(modelId)
            );
            return { data: capabilities };
        } catch (error) {
            logger.error({ err: error }, "Failed to fetch model capabilities");
            throw new AppError(
                "Failed to fetch model capabilities",
                502,
                "LLM_FETCH_ERROR"
            );
        }
    });
}
