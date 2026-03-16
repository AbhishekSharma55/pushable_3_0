import { Composio } from "@composio/core";
import { LangchainProvider } from "@composio/langchain";
import { logger } from "./logger.ts";

let composioInstance: Composio<LangchainProvider> | null = null;

export function getComposioClient(): Composio<LangchainProvider> {
    if (!composioInstance) {
        const apiKey = process.env.COMPOSIO_API_KEY;
        if (!apiKey) {
            throw new Error("COMPOSIO_API_KEY is not set");
        }
        composioInstance = new Composio({
            apiKey,
            provider: new LangchainProvider(),
        });
        logger.info("Composio client initialized");
    }
    return composioInstance;
}
