import { openrouterService } from "../services/openrouter.service.ts";

/**
 * Calculate the dollar cost of an LLM call based on actual token usage
 * and OpenRouter model pricing.
 */
export async function calculateDollarCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number
): Promise<number | null> {
    if (!modelId || (inputTokens === 0 && outputTokens === 0)) return null;

    try {
        const models = await openrouterService.getModels();
        const modelInfo = models.find((m) => m.id === modelId);
        if (!modelInfo) return null;

        const promptPrice = parseFloat(modelInfo.pricing.prompt);
        const completionPrice = parseFloat(modelInfo.pricing.completion);
        return inputTokens * promptPrice + outputTokens * completionPrice;
    } catch {
        return null;
    }
}
