import { db } from "../client.ts";
import { llmModels } from "../schema/index.ts";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.ts";

interface ModelSeed {
    provider: "openai" | "anthropic" | "google" | "deepseek" | "meta";
    modelId: string;
    displayName: string;
    description: string;
    multiplier: string;
    contextWindow: number;
    minimumPlan: "free" | "starter" | "pro" | "scale";
    isFeatured: boolean;
    sortOrder: number;
}

const MODELS: ModelSeed[] = [
    // --- OpenAI ---
    {
        provider: "openai",
        modelId: "openai/gpt-5.1-chat",
        displayName: "GPT-5.1 Chat",
        description: "Fast and conversational. Best for quick tasks and high-volume runs.",
        multiplier: "0.80",
        contextWindow: 128000,
        minimumPlan: "free",
        isFeatured: true,
        sortOrder: 1,
    },
    {
        provider: "openai",
        modelId: "openai/gpt-5.1",
        displayName: "GPT-5.1",
        description: "Strong general-purpose reasoning with improved instruction following.",
        multiplier: "1.00",
        contextWindow: 400000,
        minimumPlan: "starter",
        isFeatured: true,
        sortOrder: 2,
    },
    {
        provider: "openai",
        modelId: "openai/gpt-5.2-chat",
        displayName: "GPT-5.2 Chat",
        description: "Fast lightweight model with adaptive reasoning for interactive tasks.",
        multiplier: "1.00",
        contextWindow: 128000,
        minimumPlan: "starter",
        isFeatured: false,
        sortOrder: 3,
    },
    {
        provider: "openai",
        modelId: "openai/gpt-5.2",
        displayName: "GPT-5.2",
        description: "Latest GPT-5 series with stronger agentic and long context performance.",
        multiplier: "1.10",
        contextWindow: 400000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 4,
    },
    {
        provider: "openai",
        modelId: "openai/gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        description: "State-of-the-art agentic coding. Best for software engineering workflows.",
        multiplier: "1.10",
        contextWindow: 400000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 5,
    },
    {
        provider: "openai",
        modelId: "openai/gpt-5.4",
        displayName: "GPT-5.4",
        description: "OpenAI's latest frontier. Unified reasoning, coding, and multimodal.",
        multiplier: "1.30",
        contextWindow: 1050000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 6,
    },
    {
        provider: "openai",
        modelId: "openai/gpt-5.4-pro",
        displayName: "GPT-5.4 Pro",
        description: "Most powerful OpenAI model. Best for highest-stakes complex tasks.",
        multiplier: "2.50",
        contextWindow: 1050000,
        minimumPlan: "scale",
        isFeatured: false,
        sortOrder: 7,
    },

    // --- Anthropic ---
    {
        provider: "anthropic",
        modelId: "anthropic/claude-haiku-4-5",
        displayName: "Claude Haiku 4.5",
        description: "Fastest Claude. Near-frontier intelligence at low cost and latency.",
        multiplier: "1.20",
        contextWindow: 200000,
        minimumPlan: "starter",
        isFeatured: true,
        sortOrder: 8,
    },
    {
        provider: "anthropic",
        modelId: "anthropic/claude-sonnet-4-5",
        displayName: "Claude Sonnet 4.5",
        description: "Advanced agentic coding and multi-step workflows. State-of-the-art SWE-bench.",
        multiplier: "1.50",
        contextWindow: 1000000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 9,
    },
    {
        provider: "anthropic",
        modelId: "anthropic/claude-sonnet-4.6",
        displayName: "Claude Sonnet 4.6",
        description: "Anthropic's most capable Sonnet. Best for agents, coding, and professional work.",
        multiplier: "1.50",
        contextWindow: 1000000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 10,
    },
    {
        provider: "anthropic",
        modelId: "anthropic/claude-opus-4-5",
        displayName: "Claude Opus 4.5",
        description: "Frontier reasoning for complex software engineering and long-horizon tasks.",
        multiplier: "1.80",
        contextWindow: 200000,
        minimumPlan: "scale",
        isFeatured: false,
        sortOrder: 11,
    },
    {
        provider: "anthropic",
        modelId: "anthropic/claude-opus-4.6",
        displayName: "Claude Opus 4.6",
        description: "Anthropic's strongest model. Built for entire workflows, not single prompts.",
        multiplier: "2.00",
        contextWindow: 1000000,
        minimumPlan: "scale",
        isFeatured: true,
        sortOrder: 12,
    },

    // --- Google ---
    {
        provider: "google",
        modelId: "google/gemini-2.5-flash-lite",
        displayName: "Gemini 2.5 Flash Lite",
        description: "Ultra-low latency and cost. Best value for high-volume simple tasks.",
        multiplier: "0.50",
        contextWindow: 1050000,
        minimumPlan: "free",
        isFeatured: false,
        sortOrder: 13,
    },
    {
        provider: "google",
        modelId: "google/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        description: "Fast reasoning with built-in thinking. Great balance of speed and intelligence.",
        multiplier: "0.70",
        contextWindow: 1050000,
        minimumPlan: "free",
        isFeatured: true,
        sortOrder: 14,
    },
    {
        provider: "google",
        modelId: "google/openai/gpt-4o-mini",
        displayName: "Gemini 3 Flash",
        description: "High-speed model for agentic workflows, multi-turn chat, and coding.",
        multiplier: "0.70",
        contextWindow: 1050000,
        minimumPlan: "starter",
        isFeatured: true,
        sortOrder: 15,
    },
    {
        provider: "google",
        modelId: "google/gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        description: "Google's flagship with 1M context. Top-tier reasoning and multimodal tasks.",
        multiplier: "0.90",
        contextWindow: 1050000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 16,
    },
    {
        provider: "google",
        modelId: "google/gemini-3.1-flash-lite-preview",
        displayName: "Gemini 3.1 Flash Lite",
        description: "Cheapest Gemini with thinking levels. Half the cost of Gemini 3 Flash.",
        multiplier: "0.50",
        contextWindow: 1050000,
        minimumPlan: "starter",
        isFeatured: false,
        sortOrder: 17,
    },
    {
        provider: "google",
        modelId: "google/gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro",
        description: "Google's frontier reasoning model. Best for agentic coding and complex workflows.",
        multiplier: "1.00",
        contextWindow: 1050000,
        minimumPlan: "pro",
        isFeatured: true,
        sortOrder: 18,
    },
];

export async function seedModels(): Promise<void> {
    try {
        for (const model of MODELS) {
            await db
                .insert(llmModels)
                .values({
                    provider: model.provider,
                    modelId: model.modelId,
                    displayName: model.displayName,
                    description: model.description,
                    multiplier: model.multiplier,
                    contextWindow: model.contextWindow,
                    isActive: true,
                    minimumPlan: model.minimumPlan,
                    isFeatured: model.isFeatured,
                    sortOrder: model.sortOrder,
                })
                .onConflictDoUpdate({
                    target: llmModels.modelId,
                    set: {
                        provider: sql`excluded.provider`,
                        displayName: sql`excluded.display_name`,
                        description: sql`excluded.description`,
                        multiplier: sql`excluded.multiplier`,
                        contextWindow: sql`excluded.context_window`,
                        minimumPlan: sql`excluded.minimum_plan`,
                        isFeatured: sql`excluded.is_featured`,
                        sortOrder: sql`excluded.sort_order`,
                        updatedAt: new Date(),
                    },
                });
        }
        logger.info(`Seeded/verified ${MODELS.length} LLM models`);
    } catch (error) {
        logger.error({ error }, "Failed to seed LLM models");
    }
}
