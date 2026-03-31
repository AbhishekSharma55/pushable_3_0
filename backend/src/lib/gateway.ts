import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { logger } from "./logger.ts";

// ── Detection helpers ──────────────────────────────────────────

/** True if we should route Anthropic models directly (API key or CLI proxy). */
export function isClaudeGateway(): boolean {
    return !!(
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_CLI_PROXY_URL
    );
}

export function isAnthropicModel(modelId: string): boolean {
    return modelId.startsWith("anthropic/");
}

/** Strip the `anthropic/` prefix and normalize dots to hyphens for the Anthropic API. */
export function toClaudeModelId(modelId: string): string {
    const stripped = modelId.startsWith("anthropic/")
        ? modelId.slice("anthropic/".length)
        : modelId;
    // OpenRouter uses dots (claude-sonnet-4.6), Anthropic API uses hyphens (claude-sonnet-4-6)
    return stripped.replace(/\./g, "-");
}

// ── Prompt caching ────────────────────────────────────────────

/**
 * Custom fetch wrapper for OpenRouter that injects `cache_control` into
 * the first content block of the system message. This works around
 * `@langchain/openai`'s ChatOpenAI stripping unknown fields during
 * message serialization.
 *
 * Convention: The agent graph sends the system message with 2 content blocks:
 *   [0] = stable (cacheable) text  →  gets `cache_control: { type: "ephemeral" }`
 *   [1] = dynamic (per-turn) text  →  no cache_control
 *
 * OpenRouter passes `cache_control` through to Anthropic, enabling
 * ~90% input token cost savings on the cached prefix.
 */
function createCacheControlFetch(): typeof globalThis.fetch {
    return async (input, init) => {
        if (init?.body && typeof init.body === "string") {
            try {
                const body = JSON.parse(init.body);
                if (Array.isArray(body.messages)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const systemMsg = body.messages.find((m: any) => m.role === "system");
                    if (
                        systemMsg &&
                        Array.isArray(systemMsg.content) &&
                        systemMsg.content.length >= 2 &&
                        systemMsg.content[0]?.type === "text"
                    ) {
                        systemMsg.content[0] = {
                            ...systemMsg.content[0],
                            cache_control: { type: "ephemeral" },
                        };
                        init = { ...init, body: JSON.stringify(body) };
                    }
                }
            } catch {
                // Not JSON or malformed — pass through unchanged
            }
        }
        return globalThis.fetch(input, init);
    };
}

// ── LLM factory ────────────────────────────────────────────────

interface CreateLLMOptions {
    modelId: string;
    temperature: number;
    streaming?: boolean;
    maxRetries?: number;
    /** Controls how much compute the model uses: "low" | "medium" | "high". Default: "medium". */
    effort?: "low" | "medium" | "high";
}

/**
 * Creates the right LLM instance based on gateway config:
 *  - CLAUDE_CLI_PROXY_URL set     → ChatAnthropic via CLI proxy
 *  - ANTHROPIC_API_KEY set        → ChatAnthropic direct
 *  - Everything else              → ChatOpenAI via OpenRouter
 */
export function createLLM(options: CreateLLMOptions) {
    const {
        modelId,
        temperature,
        streaming = true,
        maxRetries = 3,
        effort = "high",
    } = options;

    const useClaudeDirect =
        isClaudeGateway() && isAnthropicModel(modelId);

    if (useClaudeDirect) {
        const cliProxyUrl = process.env.CLAUDE_CLI_PROXY_URL;
        const apiKey = process.env.ANTHROPIC_API_KEY;

        // ── CLI Proxy (Claude Code subscription via host proxy) ──
        if (cliProxyUrl) {
            logger.info(
                { modelId, claudeModel: toClaudeModelId(modelId), proxyUrl: cliProxyUrl },
                "Using Claude CLI proxy gateway"
            );

            const build = () =>
                new ChatAnthropic({
                    model: toClaudeModelId(modelId),
                    temperature,
                    streaming,
                    maxRetries,
                    anthropicApiKey: "cli-proxy",
                    clientOptions: {
                        baseURL: cliProxyUrl,
                    },
                    outputConfig: { effort },
                });

            return {
                llm: build(),
                isClaudeDirect: true,
                supportsPromptCaching: true,
                recreate: build,
            };
        }

        // ── Standard API key (sk-ant-api03-…) ──
        if (!apiKey) {
            throw new Error(
                "Anthropic model requested but neither ANTHROPIC_API_KEY nor CLAUDE_CLI_PROXY_URL is set"
            );
        }

        logger.info(
            { modelId, claudeModel: toClaudeModelId(modelId) },
            "Using Anthropic API key (direct)"
        );

        const build = () =>
            new ChatAnthropic({
                model: toClaudeModelId(modelId),
                temperature,
                streaming,
                maxRetries,
                anthropicApiKey: apiKey,
                outputConfig: { effort },
            });

        return {
            llm: build(),
            isClaudeDirect: true,
            supportsPromptCaching: true,
            recreate: build,
        };
    }

    // ── OpenRouter (default) ───────────────────────────────────
    const isOpenRouter = modelId.includes("/");

    if (isOpenRouter && !process.env.OPENROUTER_KEY) {
        throw new Error("OPENROUTER_KEY is not set in environment");
    }

    // Enable prompt caching for Anthropic models on OpenRouter via custom fetch
    const usePromptCaching = isOpenRouter && isAnthropicModel(modelId);

    logger.info({ modelId, isOpenRouter, promptCaching: usePromptCaching }, "Using OpenRouter gateway");

    const build = () =>
        new ChatOpenAI({
            model: modelId,
            temperature,
            streaming,
            streamUsage: streaming,
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
                      ...(usePromptCaching ? { fetch: createCacheControlFetch() } : {}),
                  }
                : { apiKey: process.env.OPENAI_API_KEY },
        });

    return { llm: build(), isClaudeDirect: false, supportsPromptCaching: usePromptCaching, recreate: build };
}

// ── Raw API call (for utility functions like nl-to-cron) ───────

/**
 * Lightweight wrapper for simple LLM calls.
 * Routes through CLI proxy if available, otherwise direct API.
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
        model = "claude-haiku-4-5",
        temperature = 0,
        max_tokens = 1024,
    } = options;

    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
        model,
        messages: nonSystem,
        temperature,
        max_tokens,
    };
    if (systemMsg) body.system = systemMsg.content;

    // Determine endpoint and auth
    const cliProxyUrl = process.env.CLAUDE_CLI_PROXY_URL;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const url = cliProxyUrl
        ? `${cliProxyUrl}/v1/messages`
        : "https://api.anthropic.com/v1/messages";

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    };

    if (cliProxyUrl) {
        headers["x-api-key"] = "cli-proxy";
    } else if (apiKey) {
        headers["x-api-key"] = apiKey;
    } else {
        throw new Error("No Anthropic API key or CLI proxy configured");
    }

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Claude API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
        content: { type: string; text: string }[];
    };
    return data.content.find((c) => c.type === "text")?.text || "";
}
