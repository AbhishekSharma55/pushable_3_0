import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { logger } from "./logger.ts";

// ── In-memory token (refreshable) ──────────────────────────────
let currentAccessToken = process.env.CLAUDE_ACCESS_TOKEN || "";

// ── Detection helpers ──────────────────────────────────────────

export function isClaudeGateway(): boolean {
    return process.env.GATEWAY?.toUpperCase() === "CLAUDE";
}

export function isAnthropicModel(modelId: string): boolean {
    return modelId.startsWith("anthropic/");
}

/** Strip the `anthropic/` prefix so the ID works with the Anthropic API. */
export function toClaudeModelId(modelId: string): string {
    return modelId.startsWith("anthropic/")
        ? modelId.slice("anthropic/".length)
        : modelId;
}

export function getClaudeAccessToken(): string {
    return currentAccessToken;
}

// ── Token refresh ──────────────────────────────────────────────

export async function refreshClaudeToken(): Promise<string> {
    const refreshToken = process.env.CLAUDE_REFRESH_TOKEN;
    if (!refreshToken) {
        throw new Error("CLAUDE_REFRESH_TOKEN is not set");
    }

    logger.info("Refreshing Claude access token…");

    const res = await fetch(
        "https://console.anthropic.com/v1/oauth/token",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }),
        }
    );

    if (!res.ok) {
        const err = await res.text();
        logger.error(
            { status: res.status, error: err },
            "Claude token refresh failed"
        );
        throw new Error(`Claude token refresh failed: ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string };
    currentAccessToken = data.access_token;
    logger.info("Claude access token refreshed");
    return currentAccessToken;
}

// ── LLM factory ────────────────────────────────────────────────

interface CreateLLMOptions {
    modelId: string;
    temperature: number;
    streaming?: boolean;
    maxRetries?: number;
}

/**
 * Creates the right LLM instance based on gateway config:
 *  - GATEWAY=CLAUDE + Anthropic model → ChatAnthropic (direct)
 *  - Everything else               → ChatOpenAI via OpenRouter
 *
 * Returns a `recreate()` helper so callers can rebuild the LLM
 * after a token refresh without duplicating constructor logic.
 */
export function createLLM(options: CreateLLMOptions) {
    const {
        modelId,
        temperature,
        streaming = true,
        maxRetries = 3,
    } = options;

    const useClaudeDirect =
        isClaudeGateway() && isAnthropicModel(modelId);

    if (useClaudeDirect) {
        if (!currentAccessToken) {
            throw new Error(
                "GATEWAY is set to CLAUDE but CLAUDE_ACCESS_TOKEN is missing"
            );
        }

        logger.info(
            { modelId, claudeModel: toClaudeModelId(modelId) },
            "Using Claude gateway (direct Anthropic API)"
        );

        const build = () =>
            new ChatAnthropic({
                model: toClaudeModelId(modelId),
                temperature,
                streaming,
                maxRetries,
                anthropicApiKey: currentAccessToken,
            });

        return { llm: build(), isClaudeDirect: true, recreate: build };
    }

    // ── OpenRouter (default) ───────────────────────────────────
    const isOpenRouter = modelId.includes("/");

    if (isOpenRouter && !process.env.OPENROUTER_KEY) {
        throw new Error("OPENROUTER_KEY is not set in environment");
    }

    logger.info({ modelId, isOpenRouter }, "Using OpenRouter gateway");

    const build = () =>
        new ChatOpenAI({
            model: modelId,
            temperature,
            streaming,
            maxRetries,
            apiKey: isOpenRouter
                ? process.env.OPENROUTER_KEY
                : process.env.OPENAI_API_KEY,
            configuration: isOpenRouter
                ? {
                      baseURL: "https://openrouter.ai/api/v1",
                      apiKey: process.env.OPENROUTER_KEY,
                      defaultHeaders: {
                          "HTTP-Referer": "https://pushable.ai",
                          "X-Title": "Pushable AI",
                      },
                  }
                : { apiKey: process.env.OPENAI_API_KEY },
        });

    return { llm: build(), isClaudeDirect: false, recreate: build };
}

// ── Raw Anthropic Messages API call (for utility functions) ────

/**
 * Lightweight wrapper around the Anthropic Messages API.
 * Used by utility functions (nl-to-cron, etc.) when GATEWAY=CLAUDE.
 * Automatically retries once on 401 after refreshing the token.
 */
export async function claudeChat(
    messages: { role: string; content: string }[],
    options: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
    } = {}
): Promise<string> {
    const {
        model = "claude-haiku-4-5-20251001",
        temperature = 0,
        max_tokens = 1024,
    } = options;

    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const makeRequest = async (token: string) => {
        const body: Record<string, unknown> = {
            model,
            messages: nonSystem,
            temperature,
            max_tokens,
        };
        if (systemMsg) body.system = systemMsg.content;

        return fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": token,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
        });
    };

    let res = await makeRequest(currentAccessToken);

    // Retry once on 401
    if (res.status === 401) {
        logger.warn("Claude token expired during utility call, refreshing…");
        const newToken = await refreshClaudeToken();
        res = await makeRequest(newToken);
    }

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Claude API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
        content: { type: string; text: string }[];
    };
    return data.content.find((c) => c.type === "text")?.text || "";
}
