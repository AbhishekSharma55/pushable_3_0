import { logger } from "../lib/logger.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterModel {
    id: string;
    name: string;
    description: string;
    context_length: number;
    pricing: {
        prompt: string;
        completion: string;
        request: string;
        image: string;
    };
    architecture: {
        input_modalities: string[];
        output_modalities: string[];
        tokenizer: string;
        instruct_type: string | null;
    };
    top_provider: {
        context_length: number;
        max_completion_tokens: number;
        is_moderated: boolean;
    };
    supported_parameters: string[];
}

export interface ProviderGroup {
    provider: string;
    models: {
        id: string;
        name: string;
        description: string;
        context_length: number;
        pricing: {
            prompt: string;
            completion: string;
        };
        supported_parameters: string[];
    }[];
}

// Cache for models (refresh every 30 minutes)
let modelsCache: OpenRouterModel[] | null = null;
let modelsCacheTimestamp = 0;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export const openrouterService = {
    /**
     * Fetch all available models from OpenRouter API
     */
    async getModels(forceRefresh = false): Promise<OpenRouterModel[]> {
        const now = Date.now();
        if (
            !forceRefresh &&
            modelsCache &&
            now - modelsCacheTimestamp < CACHE_DURATION_MS
        ) {
            return modelsCache;
        }

        try {
            const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
                headers: {
                    Authorization: `Bearer ${process.env.OPENROUTER_KEY}`,
                },
            });

            if (!response.ok) {
                throw new Error(
                    `OpenRouter API error: ${response.status} ${response.statusText}`
                );
            }

            const data = (await response.json()) as { data: OpenRouterModel[] };
            modelsCache = data.data;
            modelsCacheTimestamp = now;

            logger.info(
                `Fetched ${modelsCache.length} models from OpenRouter`
            );
            return modelsCache;
        } catch (error) {
            logger.error({ err: error }, "Failed to fetch OpenRouter models");
            // Return cached data if available, even if stale
            if (modelsCache) return modelsCache;
            throw error;
        }
    },

    /**
     * Get models grouped by provider (extracted from model id: "provider/model-name")
     */
    async getModelsByProvider(): Promise<ProviderGroup[]> {
        const models = await this.getModels();

        const providerMap = new Map<string, ProviderGroup["models"]>();

        for (const model of models) {
            // Model IDs are formatted as "provider/model-name"
            const slashIndex = model.id.indexOf("/");
            const provider =
                slashIndex > 0 ? model.id.substring(0, slashIndex) : "unknown";

            if (!providerMap.has(provider)) {
                providerMap.set(provider, []);
            }

            providerMap.get(provider)!.push({
                id: model.id,
                name: model.name,
                description: model.description,
                context_length: model.context_length,
                pricing: {
                    prompt: model.pricing.prompt,
                    completion: model.pricing.completion,
                },
                supported_parameters: model.supported_parameters,
            });
        }

        // Sort providers alphabetically, sort models within each provider
        const result: ProviderGroup[] = [];
        const sortedProviders = Array.from(providerMap.keys()).sort();

        for (const provider of sortedProviders) {
            const models = providerMap.get(provider)!;
            models.sort((a, b) => a.name.localeCompare(b.name));
            result.push({ provider, models });
        }

        return result;
    },

    /**
     * Search models by name or ID
     */
    async searchModels(query: string): Promise<OpenRouterModel[]> {
        const models = await this.getModels();
        const lowerQuery = query.toLowerCase();

        return models.filter(
            (m) =>
                m.id.toLowerCase().includes(lowerQuery) ||
                m.name.toLowerCase().includes(lowerQuery)
        );
    },
};
