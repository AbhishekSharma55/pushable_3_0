import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger.ts";

// ── In-memory token (refreshable, used for OAuth flow) ─────────
let currentAccessToken = process.env.CLAUDE_ACCESS_TOKEN || "";

// ── Detection helpers ──────────────────────────────────────────

/** Returns the Anthropic API key if set (standard key, no refresh needed). */
export function getAnthropicApiKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY;
}

/** True if we should route Anthropic models directly (API key, OAuth, or CLI proxy). */
export function isClaudeGateway(): boolean {
    return !!(
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_CLI_PROXY_URL ||
        process.env.GATEWAY?.toUpperCase() === "CLAUDE"
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

/** True when using an OAuth access token (sk-ant-oat01-…) rather than a standard API key. */
function isOAuthToken(key: string): boolean {
    return key.startsWith("sk-ant-oat");
}

export function getClaudeAccessToken(): string {
    return currentAccessToken;
}

// ── Token refresh (only needed for OAuth flow, NOT for ANTHROPIC_API_KEY) ──

export async function refreshClaudeToken(): Promise<string> {
    // Standard API key never needs refresh
    const apiKey = getAnthropicApiKey();
    if (apiKey && !isOAuthToken(apiKey)) {
        return apiKey;
    }

    const refreshToken = process.env.CLAUDE_REFRESH_TOKEN;
    if (!refreshToken) {
        throw new Error("CLAUDE_REFRESH_TOKEN is not set");
    }

    logger.info("Refreshing Claude access token…");

    const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });

    const res = await fetch(
        "https://platform.claude.com/v1/oauth/token",
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
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
        const apiKey = getAnthropicApiKey();
        const cliProxyUrl = process.env.CLAUDE_CLI_PROXY_URL;
        const effectiveKey = apiKey || currentAccessToken;

        // ── CLI Proxy (Claude Code subscription via host proxy) ──
        if (cliProxyUrl && isAnthropicModel(modelId)) {
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
                    anthropicApiUrl: cliProxyUrl,
                });

            return {
                llm: build(),
                isClaudeDirect: true,
                useStandardApiKey: true,
                recreate: build,
            };
        }

        if (!effectiveKey) {
            throw new Error(
                "Anthropic model requested but neither ANTHROPIC_API_KEY, CLAUDE_CLI_PROXY_URL, nor CLAUDE_ACCESS_TOKEN is set"
            );
        }

        const useOAuth = isOAuthToken(effectiveKey);

        logger.info(
            {
                modelId,
                claudeModel: toClaudeModelId(modelId),
                authMethod: useOAuth ? "oauth-token" : "api-key",
            },
            "Using Claude gateway (direct Anthropic API)"
        );

        const build = () => {
            if (useOAuth) {
                // OAuth tokens — only works for Haiku via public API
                return new ChatAnthropic({
                    model: toClaudeModelId(modelId),
                    temperature,
                    streaming,
                    maxRetries,
                    clientOptions: {
                        defaultHeaders: {
                            "anthropic-beta": "oauth-2025-04-20",
                        },
                    },
                    createClient: (opts) =>
                        new Anthropic({
                            ...opts,
                            apiKey: null as unknown as string,
                            authToken: currentAccessToken,
                        }),
                });
            }
            // Standard API key (sk-ant-api03-…) uses x-api-key header
            return new ChatAnthropic({
                model: toClaudeModelId(modelId),
                temperature,
                streaming,
                maxRetries,
                anthropicApiKey: effectiveKey,
            });
        };

        return {
            llm: build(),
            isClaudeDirect: true,
            useStandardApiKey: !useOAuth,
            recreate: build,
        };
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

    return { llm: build(), isClaudeDirect: false, useStandardApiKey: false, recreate: build };
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
        model = "claude-haiku-4-5",
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

        // OAuth tokens use Bearer auth + beta header, standard API keys use x-api-key
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        };
        if (isOAuthToken(token)) {
            headers["Authorization"] = `Bearer ${token}`;
            headers["anthropic-beta"] = "oauth-2025-04-20";
        } else {
            headers["x-api-key"] = token;
        }

        return fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
    };

    const apiKey = getAnthropicApiKey();
    const token = apiKey || currentAccessToken;

    let res = await makeRequest(token);

    // Retry once on 401 (token expired)
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
