import { StateGraph, Annotation, MessagesAnnotation, interrupt } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createLLM } from "../lib/gateway.ts";
import { SystemMessage, AIMessage, HumanMessage, RemoveMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";
import { randomUUID } from "crypto";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { llmModels } from "../db/schema/index.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { permissionRepository } from "../repositories/permission.repository.ts";
import { toolRepository } from "../repositories/tool.repository.ts";
import { skillRepository } from "../repositories/skill.repository.ts";
import { kbService } from "../services/kb.service.ts";
import { kbRepository } from "../repositories/kb.repository.ts";
import { buildAgentCallerTool } from "../lib/agent-tool.ts";
import { integrationRepository } from "../repositories/integration.repository.ts";
import { getComposioClient } from "../lib/composio.ts";
import { logger } from "../lib/logger.ts";
import { buildBrowserAgentTool, type BrowserAgentEventEmitter } from "../lib/browser-agent-tool.ts";
import { buildExtensionBrowserAgentTool } from "../lib/extension-browser-agent-tool.ts";
import { buildVaultTools } from "../tools/vault.tools.ts";
import { buildSystemTools } from "../tools/system.tools.ts";
import { buildMemoryTools } from "../tools/memory.tools.ts";
import { buildPlanningTools, type Todo } from "../tools/planning.tools.ts";
import { memoryRepository } from "../repositories/memory.repository.ts";
import { buildSystemPrompt } from "../lib/system-prompt-builder.ts";
import { browserRepository } from "../repositories/browser.repository.ts";
import {
    checkCredits,
    deductCredits,
    calculateCreditCost,
    isPlanSufficient,
} from "../lib/credit-engine.ts";
import { channelRepository } from "../repositories/channel.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { getBrowserAgentSettings } from "../lib/system-settings.ts";
import type {
    AgentCapabilities,
    KBCapability,
    SkillCapability,
    ToolCapability,
    MCPServerCapability,
    ConnectedAgent,
    ComposioIntegration,
    ChannelInfo,
    ChannelUserInfo,
    SystemPermissions,
} from "../lib/system-prompt-builder.ts";

const SUMMARIZE_THRESHOLD = 30; // Trigger summarization when messages exceed this count
const KEEP_MESSAGES = 10; // Keep the last N messages after summarization

/**
 * Sanitize message history to ensure proper tool call/response pairing.
 * Required for providers like Gemini that mandate tool responses immediately follow tool calls.
 * Removes orphaned ToolMessages and strips orphaned tool_calls from AIMessages.
 *
 * SAFETY: Uses raw property access (not instanceof/class checks) to handle
 * AIMessage, AIMessageChunk, and any future variants. Includes a failsafe:
 * if we detect ToolMessages but fail to find ANY tool_calls (detection bug),
 * we skip sanitization entirely rather than deleting valid messages.
 */
function sanitizeMessagesForProvider(messages: BaseMessage[]): BaseMessage[] {
    const toolCallIds = new Set<string>();
    const toolResponseIds = new Set<string>();

    for (const msg of messages) {
        // Use raw property access — works for AIMessage, AIMessageChunk, and
        // any object that carries a tool_calls array, regardless of class hierarchy.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls = (msg as any).tool_calls;
        if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
            for (const tc of rawToolCalls as Array<{ id?: string }>) {
                if (tc.id) toolCallIds.add(tc.id);
            }
        }
        if (msg instanceof ToolMessage && msg.tool_call_id) {
            toolResponseIds.add(msg.tool_call_id);
        }
    }

    const orphanedResponses = new Set<string>();
    for (const id of toolResponseIds) {
        if (!toolCallIds.has(id)) orphanedResponses.add(id);
    }
    const orphanedCalls = new Set<string>();
    for (const id of toolCallIds) {
        if (!toolResponseIds.has(id)) orphanedCalls.add(id);
    }

    if (orphanedResponses.size === 0 && orphanedCalls.size === 0) {
        return messages;
    }

    // FAILSAFE: If we found ToolMessages but zero tool_calls, our detection
    // is broken. Return messages unchanged rather than deleting valid responses.
    if (toolCallIds.size === 0 && toolResponseIds.size > 0) {
        logger.error({
            toolResponseCount: toolResponseIds.size,
        }, "Sanitization failsafe: found ToolMessages but zero tool_calls — skipping sanitization to avoid data loss");
        return messages;
    }

    logger.warn({
        orphanedResponses: orphanedResponses.size,
        orphanedCalls: orphanedCalls.size,
        totalToolCalls: toolCallIds.size,
        totalToolResponses: toolResponseIds.size,
    }, "Sanitizing orphaned tool call/response messages");

    const result: BaseMessage[] = [];
    for (const msg of messages) {
        if (msg instanceof ToolMessage && msg.tool_call_id && orphanedResponses.has(msg.tool_call_id)) {
            logger.info({ removedToolCallId: msg.tool_call_id, toolName: msg.name }, "Removing orphaned ToolMessage");
            continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls2 = (msg as any).tool_calls;
        if (Array.isArray(rawToolCalls2) && rawToolCalls2.length > 0) {
            const validCalls = rawToolCalls2.filter((tc: { id?: string }) => !tc.id || !orphanedCalls.has(tc.id));
            if (validCalls.length === 0) {
                const text = typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                        ? (msg.content as Array<{ type: string; text?: string }>)
                            .filter(b => b.type === "text")
                            .map(b => b.text ?? "")
                            .join("")
                        : "";
                if (text) {
                    result.push(new AIMessage({ content: text, id: msg.id }));
                }
                continue;
            }
            if (validCalls.length < rawToolCalls2.length) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                result.push(new AIMessage({ content: msg.content as any, tool_calls: validCalls, id: msg.id }));
                continue;
            }
        }

        result.push(msg);
    }

    return result;
}

/**
 * Recover tool calls that the model output as JSON text instead of using the
 * API's native tool calling mechanism. This is a known intermittent issue with
 * Claude where it sometimes serializes tool calls as text content rather than
 * producing proper tool_use content blocks.
 *
 * Detects: {"tool_calls":[{"name":"TOOL_NAME","input":{...}}]}
 * Returns parsed tool calls and cleaned text, or null if nothing found.
 */
function recoverToolCallsFromText(
    content: string | Array<{ type: string; text?: string }>,
    availableToolNames: Set<string>
): { toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string; type: "tool_call" }>; cleanedContent: string } | null {
    const text = typeof content === "string"
        ? content
        : Array.isArray(content)
            ? (content as Array<{ type: string; text?: string }>)
                .filter(b => b.type === "text")
                .map(b => b.text ?? "")
                .join("")
            : "";

    if (!text || !text.includes('"tool_calls"')) return null;

    // Find the {"tool_calls": marker
    const marker = '"tool_calls"';
    const markerIdx = text.indexOf(marker);
    if (markerIdx === -1) return null;

    // Walk backwards to find the opening {
    let start = markerIdx - 1;
    while (start >= 0 && /\s/.test(text[start])) start--;
    if (start < 0 || text[start] !== '{') return null;

    // Use brace counting to find the matching closing }
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end === -1) return null;

    const jsonStr = text.substring(start, end);
    try {
        const parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) {
            return null;
        }

        const toolCalls = parsed.tool_calls
            .filter((tc: Record<string, unknown>) =>
                typeof tc.name === "string" && availableToolNames.has(tc.name as string)
            )
            .map((tc: Record<string, unknown>) => ({
                name: tc.name as string,
                args: ((tc.input ?? tc.args ?? {}) as Record<string, unknown>),
                id: (typeof tc.id === "string" ? tc.id : null) || `recovered-${randomUUID()}`,
                type: "tool_call" as const,
            }));

        if (toolCalls.length === 0) return null;

        const cleanedContent = (text.substring(0, start) + text.substring(end)).trim();
        return { toolCalls, cleanedContent };
    } catch {
        return null;
    }
}

const AgentState = Annotation.Root({
    ...MessagesAnnotation.spec,
    summary: Annotation<string>({
        reducer: (_curr: string, update: string) => update,
        default: () => "",
    }),
    todos: Annotation<Todo[]>({
        reducer: (_curr: Todo[], update: Todo[]) => update,
        default: () => [],
    }),
});

let checkpointerInstance: PostgresSaver | null = null;

async function getCheckpointer(): Promise<PostgresSaver> {
    if (!checkpointerInstance) {
        checkpointerInstance = PostgresSaver.fromConnString(
            process.env.DATABASE_URL!
        );
        await checkpointerInstance.setup();
    }
    return checkpointerInstance;
}

// For now, workspace plan is always "scale". Replace when subscription system is built.
function getWorkspacePlan(_workspaceId: string): string {
    return "scale";
}

/**
 * Look up the model from our curated llmModels table.
 * If not found or plan-gated, find a fallback.
 */
async function resolveModel(
    requestedModelId: string,
    workspaceId: string
): Promise<{ modelId: string; multiplier: number; displayName: string }> {
    const plan = getWorkspacePlan(workspaceId);

    // Try to find the requested model
    const rows = await db
        .select()
        .from(llmModels)
        .where(eq(llmModels.modelId, requestedModelId))
        .limit(1);

    if (rows.length > 0) {
        const m = rows[0];
        if (m.isActive && isPlanSufficient(plan, m.minimumPlan)) {
            return {
                modelId: m.modelId,
                multiplier: Number(m.multiplier),
                displayName: m.displayName,
            };
        }

        // Model exists but plan-gated — find fallback
        logger.warn(
            { requestedModelId, plan, requiredPlan: m.minimumPlan },
            "Model requires higher plan, falling back"
        );
    }

    // Find best available model on this plan (highest sortOrder that is available)
    const available = await db
        .select()
        .from(llmModels)
        .where(eq(llmModels.isActive, true))
        .orderBy(asc(llmModels.sortOrder));

    const fallback = available.find((m) => isPlanSufficient(plan, m.minimumPlan));

    if (fallback) {
        logger.info(
            { requestedModelId, fallbackModelId: fallback.modelId },
            "Falling back to plan-available model"
        );
        return {
            modelId: fallback.modelId,
            multiplier: Number(fallback.multiplier),
            displayName: fallback.displayName,
        };
    }

    // No models in DB at all — use requested model with default multiplier
    return { modelId: requestedModelId, multiplier: 1.0, displayName: requestedModelId };
}

// ── Graph cache ──────────────────────────────────────────────────────────────
// Caches compiled agent graphs per session to avoid expensive DB queries,
// MCP connections, and Composio API calls on every message.
// A mutable ref is used for onBrowserEvent so the cached graph always
// emits browser events to the current run's event bus.

interface GraphCacheEntry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph: any; // CompiledStateGraph returned by graph.compile()
    browserEventRef: { current: BrowserAgentEventEmitter | undefined };
    timestamp: number;
}

const graphCache = new Map<string, GraphCacheEntry>();
const GRAPH_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/** Evict stale entries periodically to prevent memory leaks */
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of graphCache) {
        if (now - entry.timestamp > GRAPH_CACHE_TTL_MS * 2) {
            graphCache.delete(key);
        }
    }
}, GRAPH_CACHE_TTL_MS).unref();

/** Invalidate cache for a specific agent (call after agent config changes) */
export function invalidateGraphCache(agentId: string, workspaceId: string): void {
    const prefix = `${agentId}:${workspaceId}:`;
    for (const key of graphCache.keys()) {
        if (key.startsWith(prefix)) {
            graphCache.delete(key);
        }
    }
}

export async function createAgentGraph(
    agentId: string,
    workspaceId: string,
    userId?: string,
    onBrowserEvent?: BrowserAgentEventEmitter,
    chatSessionId?: string
) {
    // Read browser agent model early so it can be part of cache key
    const browserAgentSettings = await getBrowserAgentSettings();
    const browserModelId = browserAgentSettings.model;

    // Check graph cache — reuse compiled graph for same session + same browser model
    const cacheKey = `${agentId}:${workspaceId}:${userId || ""}:${chatSessionId || ""}:${browserModelId}`;
    const cached = graphCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL_MS) {
        // Update browser event ref to point to current run's handler
        cached.browserEventRef.current = onBrowserEvent;
        logger.info({ agentId, cacheKey }, "Using cached agent graph");
        return cached.graph;
    }

    const agent = await agentRepository.findById(agentId, workspaceId);
    if (!agent) throw new Error("Agent not found");

    // --- Resolve model with plan gating ---
    const resolvedModel = await resolveModel(agent.model, workspaceId);
    const modelId = resolvedModel.modelId;
    const modelMultiplier = resolvedModel.multiplier;

    const agentTemperature = agent.temperature ?? 0.7;
    const { llm, isClaudeDirect, recreate: recreateLLM } = createLLM({
        modelId,
        temperature: agentTemperature,
    });

    // --- Fetch all capability data in parallel ---
    const [
        allowedToolIds,
        allowedAgentIds,
        allowedKbIds,
        allowedSkillIds,
        browserProfile,
        agentIntegrations,
    ] = await Promise.all([
        permissionRepository.getAllowedResourceIds(agentId, workspaceId, "tool"),
        permissionRepository.getAllowedResourceIds(agentId, workspaceId, "agent"),
        permissionRepository.getAllowedResourceIds(agentId, workspaceId, "kb"),
        permissionRepository.getAllowedResourceIds(agentId, workspaceId, "skill"),
        browserRepository.findProfileByAgentId(agentId, workspaceId),
        integrationRepository.findByAgent(agentId, workspaceId),
    ]);

    const langchainTools: DynamicStructuredTool[] = [];
    const mcpClients: MultiServerMCPClient[] = [];

    const toolCapabilities: ToolCapability[] = [];
    const mcpServerCapabilities: MCPServerCapability[] = [];
    const composioIntegrations: ComposioIntegration[] = [];

    // --- 1. Function & MCP Tools ---
    if (allowedToolIds.length > 0) {
        const dbTools = await toolRepository.findByIds(allowedToolIds);

        for (const tool of dbTools) {
            const config = tool.config as Record<string, unknown>;

            if (tool.type === "function") {
                const webhookUrl = config.webhookUrl as string;
                if (!webhookUrl) {
                    logger.warn({ toolId: tool.id }, "Function tool missing webhookUrl, skipping");
                    continue;
                }

                const method = ((config.method as string) || "POST").toUpperCase();

                const varPattern = /\{\{(\w+)\}\}/g;
                const urlVars: string[] = [];
                let match;
                while ((match = varPattern.exec(webhookUrl)) !== null) {
                    if (!urlVars.includes(match[1])) {
                        urlVars.push(match[1]);
                    }
                }

                const schemaFields: Record<string, z.ZodTypeAny> = {};
                for (const v of urlVars) {
                    schemaFields[v] = z.string().describe(`Value for {{${v}}} in the URL`);
                }
                if (method === "POST") {
                    schemaFields["input"] = z.string().describe("The input/body to send to the tool").optional();
                }
                if (urlVars.length === 0 && method !== "POST") {
                    schemaFields["input"] = z.string().describe("The input to send to the tool").optional();
                }

                const paramDesc = Object.keys(schemaFields).join(", ") || "none";

                const functionTool = new DynamicStructuredTool({
                    name: tool.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
                    description: tool.description || `Execute ${tool.name}`,
                    schema: z.object(schemaFields),
                    func: async (params) => {
                        let resolvedUrl = webhookUrl;
                        for (const v of urlVars) {
                            const value = params[v] as string;
                            resolvedUrl = resolvedUrl.replace(
                                new RegExp(`\\{\\{${v}\\}\\}`, "g"),
                                encodeURIComponent(value)
                            );
                        }

                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 30_000);
                        try {
                            const fetchOptions: RequestInit = {
                                method,
                                signal: controller.signal,
                            };

                            if (method === "POST") {
                                fetchOptions.headers = { "Content-Type": "application/json" };
                                fetchOptions.body = JSON.stringify({ input: params.input ?? "" });
                            }

                            const response = await fetch(resolvedUrl, fetchOptions);
                            return await response.text();
                        } catch (error) {
                            logger.error({ error, toolId: tool.id }, "Function tool call failed");
                            return `Error calling tool: ${error instanceof Error ? error.message : "Unknown error"}`;
                        } finally {
                            clearTimeout(timeout);
                        }
                    },
                });

                langchainTools.push(functionTool);
                toolCapabilities.push({
                    name: tool.name,
                    description: tool.description,
                    parameters: paramDesc,
                });
            } else if (tool.type === "mcp") {
                const mcpUrl = config.url as string;
                if (!mcpUrl) {
                    logger.warn({ toolId: tool.id }, "MCP tool missing URL, skipping");
                    continue;
                }

                try {
                    const mcpClient = new MultiServerMCPClient({
                        [tool.name]: {
                            url: mcpUrl,
                            transport: "sse",
                        },
                    });

                    const mcpToolsList = await mcpClient.getTools();
                    mcpClients.push(mcpClient);

                    const toolNames = config.toolNames as string[] | undefined;
                    const filtered = toolNames && toolNames.length > 0
                        ? mcpToolsList.filter((t) => toolNames.includes(t.name))
                        : mcpToolsList;

                    const mcpToolNames: string[] = [];
                    for (const mcpTool of filtered) {
                        langchainTools.push(mcpTool as DynamicStructuredTool);
                        mcpToolNames.push(mcpTool.name);
                    }

                    mcpServerCapabilities.push({
                        name: tool.name,
                        description: tool.description,
                        toolNames: mcpToolNames,
                    });
                } catch (error) {
                    logger.warn(
                        { error, toolId: tool.id, mcpUrl },
                        "Failed to connect to MCP server, skipping tool"
                    );
                }
            }
        }
    }

    // --- 2. Agent delegation tools (parallel) ---
    const delegateAgentIds = allowedAgentIds.filter((id) => id !== agentId);
    const connectedAgents: ConnectedAgent[] = [];

    if (delegateAgentIds.length > 0) {
        const delegateResults = await Promise.all(
            delegateAgentIds.map(async (targetAgentId) => {
                try {
                    const targetAgent = await agentRepository.findById(targetAgentId, workspaceId);
                    if (targetAgent) {
                        const agentTool = await buildAgentCallerTool(
                            agentId,
                            targetAgentId,
                            workspaceId
                        );
                        if (agentTool) {
                            return {
                                tool: agentTool,
                                agent: {
                                    id: targetAgent.id,
                                    name: targetAgent.name,
                                    role: targetAgent.systemPrompt?.split("\n")[0] || "General Assistant",
                                } as ConnectedAgent,
                            };
                        }
                    }
                    return null;
                } catch (error) {
                    logger.warn(
                        { error, targetAgentId },
                        "Failed to build agent caller tool, skipping"
                    );
                    return null;
                }
            })
        );

        for (const result of delegateResults) {
            if (result) {
                langchainTools.push(result.tool);
                connectedAgents.push(result.agent);
            }
        }
    }

    // --- 3. Composio integration tools ---
    // Composio uses meta tools (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL, etc.)
    // that discover and execute app-specific actions at runtime. We pass meta tools once
    // and build the composioIntegrations list so the system prompt tells the agent which
    // connections are available.
    let composioToolCount = 0;
    const activeIntegrations = agentIntegrations.filter(
        (i) => i.status === "active"
    );

    if (activeIntegrations.length > 0) {
        try {
            const composio = getComposioClient();

            const toolkitSlugs = [...new Set(activeIntegrations.map((i) => i.composioToolkitSlug))];

            // Build per-toolkit tool permissions from integration metadata
            const toolsConfig: Record<string, { enable: string[] } | { disable: string[] }> = {};
            for (const integ of activeIntegrations) {
                const slug = integ.composioToolkitSlug;
                const perms = (integ.metadata as Record<string, unknown>)?.toolPermissions as {
                    mode?: string;
                    tools?: string[];
                } | undefined;

                if (perms?.tools && perms.tools.length > 0) {
                    if (perms.mode === "allowlist") {
                        toolsConfig[slug] = { enable: perms.tools };
                    } else {
                        toolsConfig[slug] = { disable: perms.tools };
                    }
                }
            }

            const sessionConfig: Record<string, unknown> = {
                toolkits: toolkitSlugs,
            };
            if (Object.keys(toolsConfig).length > 0) {
                sessionConfig.tools = toolsConfig;
            }

            const session = await composio.create(workspaceId, sessionConfig);
            const composioTools = await session.tools();

            // Add all meta tools (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL, etc.)
            if (Array.isArray(composioTools)) {
                for (const tool of composioTools) {
                    const castTool = tool as unknown as DynamicStructuredTool;
                    langchainTools.push(castTool);
                    composioToolCount++;
                }
            }

            // Build integration metadata for system prompt so the agent knows which connections exist
            for (const integ of activeIntegrations) {
                const slug = integ.composioToolkitSlug;
                const label = integ.connectionLabel || integ.name;
                const appDisplayName = slug.charAt(0).toUpperCase() + slug.slice(1);

                composioIntegrations.push({
                    connectionLabel: label,
                    connectionDescription: integ.connectionDescription ?? undefined,
                    app: slug,
                    appDisplayName,
                    actions: [`Use COMPOSIO_SEARCH_TOOLS to find ${slug} actions, then COMPOSIO_MULTI_EXECUTE_TOOL to execute them`],
                });
            }
        } catch (error) {
            logger.warn(
                { error, agentId },
                "Failed to load Composio tools, proceeding without them"
            );
        }
    }

    // --- 4. Browser Agent (load ONLY the selected browser type) ---
    // Use a mutable ref so the cached graph always emits to the current run
    const browserEventRef: { current: BrowserAgentEventEmitter | undefined } = { current: onBrowserEvent };
    const stableBrowserEventEmitter: BrowserAgentEventEmitter = (event) => {
        browserEventRef.current?.(event);
    };

    let hasBrowser = false;
    const browserType = agent.browserType || "cloud";

    logger.info({ browserModelId }, "Browser agent using model from system_settings");

    if (browserType === "cloud") {
        // Cloud browser: autonomous sub-agent with internal browser tools
        try {
            const browserAgentTool = await buildBrowserAgentTool(
                agentId,
                workspaceId,
                browserModelId,
                modelMultiplier,
                agentTemperature,
                stableBrowserEventEmitter,
                chatSessionId
            );
            if (browserAgentTool) {
                langchainTools.push(browserAgentTool);
                hasBrowser = true;
            }
        } catch (error) {
            logger.warn(
                { error, agentId },
                "Failed to load cloud browser agent, proceeding without it"
            );
        }
    } else if (browserType === "extension") {
        // Extension browser: autonomous sub-agent using Chrome extension tools
        try {
            const extBrowserAgentTool = buildExtensionBrowserAgentTool(
                agentId,
                workspaceId,
                modelMultiplier,
                agentTemperature,
                stableBrowserEventEmitter,
                browserModelId
            );
            if (extBrowserAgentTool) {
                langchainTools.push(extBrowserAgentTool);
                hasBrowser = true;
            }
        } catch (error) {
            logger.warn(
                { error, agentId },
                "Failed to load extension browser agent, proceeding without it"
            );
        }
    }

    // --- 5. Fetch KB metadata for prompt builder (parallel) ---
    const kbCapabilities: KBCapability[] = [];
    if (allowedKbIds.length > 0) {
        try {
            const kbs = await kbRepository.findKBsByIds(allowedKbIds, workspaceId);
            const kbsWithDocs = await Promise.all(
                kbs.map(async (kb) => {
                    const docs = await kbRepository.findDocumentsByKB(kb.id, workspaceId);
                    return {
                        name: kb.name,
                        description: kb.description,
                        documentCount: docs.length,
                    };
                })
            );
            kbCapabilities.push(...kbsWithDocs);
        } catch (error) {
            logger.warn({ error }, "Failed to fetch KB metadata for prompt builder");
        }
    }

    // --- 6b. Vault tools (Bitwarden credential access) ---
    try {
        const vaultTools = await buildVaultTools(workspaceId);
        langchainTools.push(...vaultTools);
    } catch (error) {
        logger.warn(
            { error, agentId },
            "Failed to load vault tools, proceeding without them"
        );
    }

    // --- 6c. Fetch skill metadata for prompt builder ---
    const permittedSkills = await skillRepository.findByIds(
        allowedSkillIds,
        workspaceId
    );
    const skillCapabilities: SkillCapability[] = permittedSkills.map((s) => ({
        name: s.name,
        description: s.description,
    }));

    // --- 7. System tools ---
    const systemPermissions: SystemPermissions = {
        canManageKB: agent.canManageKB,
        canManageSkills: agent.canManageSkills,
        canManageTools: agent.canManageTools,
        canManageSchedules: agent.canManageSchedules,
        canManageChannels: agent.canManageChannels,
        canManageAgents: agent.canManageAgents,
    };

    if (agent.systemLevelAccess) {
        const systemTools = buildSystemTools({
            agentId,
            workspaceId,
            permissions: systemPermissions,
        });
        langchainTools.push(...systemTools);
    }

    // --- 8. Memory tools (when user context is available) ---
    if (userId) {
        const memoryTools = buildMemoryTools({ workspaceId, agentId, userId });
        langchainTools.push(...memoryTools);
    }

    // --- 8b. Planning tools (write_todos, update_todo, get_todos) ---
    // Use a mutable ref that gets synced with graph state in the agent node
    let currentTodos: Todo[] = [];
    const planningTools = buildPlanningTools(
        () => currentTodos,
        (todos) => { currentTodos = todos; }
    );
    langchainTools.push(...planningTools);

    // --- 8c. Decision confirmation tool (human-in-the-loop for decisions) ---
    const askUserConfirmationTool = new DynamicStructuredTool({
        name: "ask_user_confirmation",
        description:
            "Ask the user to confirm before taking a significant action. " +
            "Use this before sending messages, deleting resources, creating system resources, " +
            "or making any irreversible change. Present a clear, human-readable question.",
        schema: z.object({
            question: z
                .string()
                .describe(
                    "A clear question for the user. E.g. 'Should I send this message to John on Telegram?'"
                ),
            context: z
                .string()
                .optional()
                .describe(
                    "Additional context to show the user — draft content, what will be deleted, etc."
                ),
        }),
        func: async () => {
            // Execution is handled by the tool node via interrupt — this is never called directly
            return "Confirmation processed.";
        },
    });
    langchainTools.push(askUserConfirmationTool);

    // --- 9. Channel awareness + send message tool ---
    const channelInfos: ChannelInfo[] = [];
    try {
        const allConnections = await channelRepository.findByWorkspace(workspaceId);
        const agentConnections = allConnections.filter(
            (c) => c.agentId === agentId && c.status === "active"
        );

        for (const conn of agentConnections) {
            const config = (conn.config || {}) as Record<string, unknown>;
            const knownUsersMap = (config.knownUsers as Record<
                string,
                { username: string; firstName: string; chatId?: string }
            >) || {};

            const users: ChannelUserInfo[] = Object.entries(knownUsersMap).map(
                ([uid, info]) => ({
                    userId: uid,
                    username: info.username || "",
                    firstName: info.firstName || "",
                    chatId: info.chatId,
                })
            );

            channelInfos.push({
                connectionId: conn.id,
                channelType: conn.channelType as "telegram" | "slack",
                name: conn.name,
                status: conn.status,
                knownUsers: users,
            });
        }

        // Build the send_channel_message tool if there are active channels
        if (agentConnections.length > 0) {
            const sendChannelMessageTool = new DynamicStructuredTool({
                name: "send_channel_message",
                description:
                    "Send a message to a specific user on a connected messaging channel (Telegram/Slack). " +
                    "You can identify the user by their name, username, or user ID. " +
                    "The system will resolve the correct user from known users.",
                schema: z.object({
                    user: z
                        .string()
                        .describe(
                            "The user to send to — can be a name (e.g. 'John'), username (e.g. 'john_doe'), or user ID"
                        ),
                    message: z.string().describe("The message text to send"),
                    channel_name: z
                        .string()
                        .optional()
                        .describe(
                            "Optional: specific channel connection name if the agent has multiple channels"
                        ),
                }),
                func: async (params) => {
                    const { user, message, channel_name } = params;

                    // Find matching connection(s)
                    let targetConnections = agentConnections;
                    if (channel_name) {
                        targetConnections = agentConnections.filter(
                            (c) =>
                                c.name
                                    .toLowerCase()
                                    .includes(channel_name.toLowerCase())
                        );
                        if (targetConnections.length === 0) {
                            return `No channel found matching "${channel_name}". Available: ${agentConnections.map((c) => c.name).join(", ")}`;
                        }
                    }

                    // Search for the user across connections
                    const userLower = user.toLowerCase().replace(/^@/, "");
                    for (const conn of targetConnections) {
                        const config = (conn.config || {}) as Record<
                            string,
                            unknown
                        >;
                        const knownUsersMap = (config.knownUsers as Record<
                            string,
                            {
                                username: string;
                                firstName: string;
                                chatId?: string;
                            }
                        >) || {};

                        // Find user by name, username, or ID
                        const matchedEntry = Object.entries(
                            knownUsersMap
                        ).find(([uid, info]) => {
                            return (
                                uid === user ||
                                (info.username &&
                                    info.username.toLowerCase() ===
                                        userLower) ||
                                (info.firstName &&
                                    info.firstName.toLowerCase() ===
                                        userLower)
                            );
                        });

                        if (matchedEntry) {
                            const [userId, userInfo] = matchedEntry;
                            const chatId = userInfo.chatId || userId;

                            if (conn.channelType === "telegram") {
                                const telegramAdapter =
                                    channelManager.getTelegramAdapter();
                                const sent =
                                    await telegramAdapter.sendDirectMessage(
                                        conn.id,
                                        chatId,
                                        message
                                    );
                                if (sent) {
                                    const displayName =
                                        userInfo.firstName ||
                                        userInfo.username ||
                                        userId;
                                    return `Message sent to ${displayName} on ${conn.name} (Telegram).`;
                                }
                                return `Failed to send message to user. They may need to start a conversation with the bot first.`;
                            }

                            // TODO: Slack support
                            return `Sending messages on ${conn.channelType} is not yet supported.`;
                        }
                    }

                    // No match found — list known users
                    const allUsers: string[] = [];
                    for (const conn of targetConnections) {
                        const config = (conn.config || {}) as Record<
                            string,
                            unknown
                        >;
                        const knownUsersMap = (config.knownUsers as Record<
                            string,
                            {
                                username: string;
                                firstName: string;
                            }
                        >) || {};
                        for (const [uid, info] of Object.entries(
                            knownUsersMap
                        )) {
                            const name =
                                info.firstName || info.username || uid;
                            allUsers.push(name);
                        }
                    }

                    if (allUsers.length > 0) {
                        return `No user found matching "${user}". Known users: ${allUsers.join(", ")}`;
                    }
                    return `No user found matching "${user}". No users have interacted with the bot yet.`;
                },
            });

            langchainTools.push(sendChannelMessageTool);
        }
    } catch (error) {
        logger.warn(
            { error, agentId },
            "Failed to load channel info for agent"
        );
    }

    // --- Build capability-aware system prompt ---
    const capabilities: AgentCapabilities = {
        kbs: kbCapabilities,
        skills: skillCapabilities,
        tools: toolCapabilities,
        mcpServers: mcpServerCapabilities,
        hasBrowser,
        hasExtensionBrowser: browserType === "extension" && hasBrowser,
        browserProfileName: browserProfile?.name,
        connectedAgents,
        composioIntegrations,
        channels: channelInfos,
        systemLevelAccess: agent.systemLevelAccess,
        systemPermissions,
    };

    const baseSystemPrompt = buildSystemPrompt(
        {
            name: agent.name,
            role: agent.systemPrompt?.split("\n")[0] || "",
            description: agent.systemPrompt || "",
        },
        capabilities
    );

    logger.info(
        {
            agentId,
            modelId,
            modelMultiplier,
            toolCount: langchainTools.length,
            delegateAgents: delegateAgentIds.length,
            composioTools: composioToolCount,
            kbCount: allowedKbIds.length,
            skillCount: permittedSkills.length,
            systemAccess: agent.systemLevelAccess,
        },
        "Agent graph created"
    );

    // Bind tools to LLM
    const llmWithTools = langchainTools.length > 0
        ? llm.bindTools(langchainTools)
        : llm;

    // Build skills section once
    let skillsSection = "";
    if (permittedSkills.length > 0) {
        const skillLines = permittedSkills
            .map((s) => `- ${s.name}: ${s.instructions}`)
            .join("\n");
        skillsSection = `\n\nSkills you must apply:\n${skillLines}`;
    }

    const agentNode = async (state: typeof AgentState.State, config: RunnableConfig) => {
        // Sync planning state from graph state
        currentTodos = state.todos || [];

        const estimatedCost = calculateCreditCost({
            action: "chat_message",
            modelMultiplier,
        });

        // Prepare KB query input before Promise.all
        const lastUserMsg = allowedKbIds.length > 0
            ? [...state.messages].reverse().find((m) => m instanceof HumanMessage)
            : null;
        const lastUserMsgContent =
            lastUserMsg && typeof lastUserMsg.content === "string"
                ? lastUserMsg.content
                : null;

        // --- Run credit check, memories, and KB query in PARALLEL ---
        const [creditCheck, memories, kbResults] = await Promise.all([
            checkCredits(workspaceId, estimatedCost),
            userId
                ? memoryRepository
                      .findByUser(workspaceId, agentId, userId)
                      .catch((error) => {
                          logger.warn({ error }, "Failed to load long-term memories");
                          return [] as Awaited<ReturnType<typeof memoryRepository.findByUser>>;
                      })
                : Promise.resolve([] as Awaited<ReturnType<typeof memoryRepository.findByUser>>),
            lastUserMsgContent
                ? kbService
                      .queryKB(allowedKbIds, lastUserMsgContent, workspaceId, 5)
                      .catch((error) => {
                          logger.warn({ error, agentId }, "KB query failed, proceeding without context");
                          return [] as Awaited<ReturnType<typeof kbService.queryKB>>;
                      })
                : Promise.resolve([] as Awaited<ReturnType<typeof kbService.queryKB>>),
        ]);

        if (!creditCheck.allowed) {
            const errorMsg = `Insufficient credits. Available: ${creditCheck.available}. Required: ~${estimatedCost}. Top up at Settings > Billing.`;
            return { messages: [new AIMessage(errorMsg)], todos: currentTodos };
        }

        // Build dynamic system prompt
        const systemPromptParts: string[] = [];

        // 0. Inject conversation summary if exists
        if (state.summary) {
            systemPromptParts.push(
                `## Conversation Summary (earlier messages)\n${state.summary}`
            );
        }

        // 0b. Inject long-term memories for this user
        if (memories.length > 0) {
            const processMemories = memories.filter((m) => m.category === "process");
            const otherMemories = memories.filter((m) => m.category !== "process");

            const memoryParts: string[] = [];

            if (processMemories.length > 0) {
                const processLines = processMemories
                    .map((m) => `- ${m.content}`)
                    .join("\n");
                memoryParts.push(
                    `### Learned Processes & Workflows (FOLLOW THESE)\n` +
                    `These are processes the user taught you. When a request matches one of these, follow it exactly:\n${processLines}`
                );
            }

            if (otherMemories.length > 0) {
                const otherLines = otherMemories
                    .map((m) => `- [${m.category}] ${m.content}`)
                    .join("\n");
                memoryParts.push(
                    `### User Facts & Preferences\n${otherLines}`
                );
            }

            systemPromptParts.push(
                `## Long-term Memories About This User\n` +
                `⚠️ You MUST read and apply these memories. They represent things this user has already told you.\n\n` +
                memoryParts.join("\n\n")
            );
        }

        // 1. KB context (RAG) — with credit deduction
        if (kbResults.length > 0) {
            const context = kbResults
                .map((r) => r.content)
                .join("\n\n---\n\n");
            systemPromptParts.push(
                `Relevant context from knowledge base:\n${context}`
            );
            // Deduct KB query credits (fire-and-forget)
            deductCredits({
                workspaceId,
                amount: calculateCreditCost({ action: "kb_query" }),
                type: "kb_query",
                metadata: { agentId, kbIds: allowedKbIds },
            }).catch((err) =>
                logger.warn({ err }, "KB query credit deduction failed")
            );
        }

        // 2. Capability-aware system prompt
        systemPromptParts.push(baseSystemPrompt);

        // 3. Skills instructions
        if (skillsSection) {
            systemPromptParts.push(skillsSection);
        }

        // 4. Artifact generation instructions
        systemPromptParts.push(`## File & Document Generation

When the user asks you to create, write, or generate any document,
report, file, spreadsheet, webpage, or content — respond using
an artifact block.

Format:
<artifact type="TYPE" filename="FILENAME">
CONTENT
</artifact>

Supported types and when to use them:
- html → webpages, styled reports, dashboards, emails
- markdown → documentation, notes, READMEs, reports
- mdx → rich docs with components
- txt → plain text, logs, config files, scripts
- csv → tabular data, exports, datasets
- xlsx → spreadsheets (output as CSV inside the artifact — frontend converts)
- pdf → formal documents (output as HTML inside artifact — frontend converts)

Rules:
- ALWAYS use an artifact when generating file content
- Put the artifact tag at the END of your message
- You may write a brief message before the artifact (e.g. "Here's your report:")
- Never put the artifact inline inside a sentence
- For xlsx: output valid CSV inside the artifact, set type="xlsx"
- For pdf: output styled HTML inside the artifact, set type="pdf"
- Filename should be descriptive and lowercase with hyphens`);

        // 5. Inject current plan state if there is one
        if (currentTodos.length > 0) {
            const completed = currentTodos.filter((t) => t.status === "completed").length;
            const todoLines = currentTodos.map((t, i) => {
                const icon = t.status === "completed" ? "done" : t.status === "in_progress" ? "..." : " ";
                return `${i + 1}. [${icon}] ${t.title}${t.result ? ` → ${t.result}` : ""}`;
            }).join("\n");
            systemPromptParts.push(
                `## Current Plan (${completed}/${currentTodos.length} completed)\n${todoLines}\n\n` +
                `Continue executing the next pending step. Update each todo as you work on it.`
            );
        }

        // 6. Memory capability instructions
        if (userId) {
            systemPromptParts.push(`## Memory — IMPORTANT
You have a \`save_memory\` tool. You MUST use it aggressively to learn from every conversation. The user should NEVER have to repeat themselves.

### When to save (DO THIS EVERY TIME):
- **Processes & Workflows:** If the user explains how to do something step-by-step, save the ENTIRE process immediately. This is the most important type of memory.
- **Corrections:** If the user corrects you ("no, do it this way", "that's wrong"), save their correction as a process or preference so you never repeat the mistake.
- **Preferences & Rules:** How they want things done, formatting rules, communication style, tools they prefer.
- **Facts:** Names, roles, project details, technical stack, team structure, important context.
- **Decisions:** Choices made, reasons behind them, trade-offs considered.

### How to save:
- Write memories as **detailed, standalone statements** that your future self can act on without any other context.
- For processes, include ALL steps in order with enough detail to execute them independently.
- Use category "process" for workflows/instructions, "preference" for how they like things, "fact" for information, "decision" for choices made.
- BAD: "User told me about deployment" — too vague, useless.
- GOOD: "Deployment process: 1) Run 'npm test' 2) Build with 'docker build -t app .' 3) Push to staging with 'kubectl apply -f staging.yaml' 4) Wait for user approval 5) Push to production with 'kubectl apply -f prod.yaml'"

### How to use saved memories:
- Your previously saved memories are included at the top of this prompt. READ THEM CAREFULLY before every response.
- If a saved memory describes a process relevant to the user's current request, FOLLOW IT exactly without asking.
- If a saved memory contains a preference, APPLY IT automatically.
- If you're unsure whether a memory applies, follow it — the user saved it for a reason.

### Rule: When in doubt, SAVE IT. It's better to save too much than to forget something the user told you.`);
        }

        const systemMsg = new SystemMessage(systemPromptParts.join("\n\n"));
        let response;
        try {
            const sanitizedMessages = sanitizeMessagesForProvider(state.messages);
            logger.info({
                messageCount: state.messages.length,
                sanitizedMessageCount: sanitizedMessages.length,
                systemPromptLength: systemPromptParts.join("\n\n").length,
                toolCount: langchainTools.length,
                isClaudeDirect,
                modelId,
                lastMessageType: state.messages[state.messages.length - 1]?.constructor?.name,
            }, "Invoking LLM");
            response = await llmWithTools.invoke([systemMsg, ...sanitizedMessages], config);

            // Debug: log what the model returned
            const aiResponse = response as AIMessage;
            const responseToolCalls = aiResponse.tool_calls ?? [];
            const responseContent = typeof aiResponse.content === "string"
                ? aiResponse.content
                : Array.isArray(aiResponse.content)
                    ? (aiResponse.content as Array<{ type: string; text?: string }>)
                        .filter(b => b.type === "text")
                        .map(b => b.text ?? "")
                        .join("")
                    : "";

            // --- Recover tool calls output as text (Claude intermittent issue) ---
            // Claude sometimes serializes tool calls as JSON text (e.g.
            // {"tool_calls":[{"name":"TOOL","input":{...}}]}) instead of using
            // the API's native tool_use blocks. Detect this and convert to proper
            // tool_calls so the graph routes to the tool node correctly.
            if (responseToolCalls.length === 0 && responseContent.length > 0 && langchainTools.length > 0) {
                const availableToolNames = new Set(langchainTools.map(t => t.name));
                const recovered = recoverToolCallsFromText(aiResponse.content, availableToolNames);
                if (recovered) {
                    logger.warn({
                        recoveredCount: recovered.toolCalls.length,
                        toolNames: recovered.toolCalls.map(tc => tc.name),
                        originalContentPreview: responseContent.slice(0, 200),
                    }, "Recovered tool calls from text — model serialized tool calls as JSON instead of using API tool_use");
                    response = new AIMessage({
                        content: recovered.cleanedContent,
                        tool_calls: recovered.toolCalls,
                    });
                }
            }

            const finalToolCalls = (response as AIMessage).tool_calls ?? [];
            logger.info({
                responseContentLength: responseContent.length,
                responseContentPreview: responseContent.slice(0, 200),
                responseToolCallCount: finalToolCalls.length,
                responseToolCallNames: finalToolCalls.map(tc => tc.name),
                wasRecovered: finalToolCalls.length > 0 && responseToolCalls.length === 0,
            }, "LLM response received");
        } catch (error: unknown) {
            logger.error({ error, isClaudeDirect, modelId }, "LLM invocation error details");
            throw error;
        }

        // --- Deduct credits AFTER successful LLM response (fire-and-forget) ---
        deductCredits({
            workspaceId,
            amount: estimatedCost,
            type: "chat_message",
            metadata: {
                agentId,
                modelId,
                multiplier: modelMultiplier,
                baseCredits: 5,
                finalCredits: estimatedCost,
            },
        }).catch((err) =>
            logger.warn({ err }, "Chat message credit deduction failed")
        );

        return { messages: [response], todos: currentTodos };
    };

    // Summarization node — compresses older messages into a summary
    const summarizeConversation = async (state: typeof AgentState.State, config: RunnableConfig) => {
        const { summary, messages } = state;

        let summaryPrompt: string;
        if (summary) {
            summaryPrompt =
                `This is a summary of the conversation to date: ${summary}\n\n` +
                `Extend the summary by taking into account the new messages above. ` +
                `Preserve all important facts, user preferences, decisions, and context:`;
        } else {
            summaryPrompt =
                `Create a concise summary of the conversation above. ` +
                `Preserve all important facts, user preferences, decisions, and context:`;
        }

        const allMessages = [
            ...sanitizeMessagesForProvider(messages),
            new HumanMessage({ id: randomUUID(), content: summaryPrompt }),
        ];

        const response = await llm.invoke(allMessages, config);

        // Keep the last N messages, but walk boundary back to avoid splitting tool call/response pairs
        let boundary = messages.length - KEEP_MESSAGES;
        if (boundary > 0) {
            // Walk back until we land on a HumanMessage (safe split point)
            while (boundary > 0 && !(messages[boundary] instanceof HumanMessage)) {
                boundary--;
            }
        }
        if (boundary <= 0) boundary = 0;

        const deleteMessages = messages
            .slice(0, boundary)
            .filter((m) => m.id)
            .map((m) => new RemoveMessage({ id: m.id! }));

        const summaryContent =
            typeof response.content === "string"
                ? response.content
                : Array.isArray(response.content)
                    ? response.content
                        .filter((b: { type: string }) => b.type === "text")
                        .map((b: { text: string }) => b.text)
                        .join("")
                    : "";

        return { summary: summaryContent, messages: deleteMessages };
    };

    // Route function — decides: tools, summarize, or end
    const shouldContinue = (state: typeof AgentState.State) => {
        const lastMessage = state.messages[state.messages.length - 1];
        if (
            lastMessage &&
            "tool_calls" in lastMessage &&
            (lastMessage as AIMessage).tool_calls &&
            (lastMessage as AIMessage).tool_calls!.length > 0
        ) {
            logger.info({
                route: "tools",
                toolCallCount: (lastMessage as AIMessage).tool_calls!.length,
                toolCallNames: (lastMessage as AIMessage).tool_calls!.map(tc => tc.name),
                messageCount: state.messages.length,
            }, "shouldContinue → tools");
            return "tools";
        }
        // Check if conversation is long enough to warrant summarization
        if (state.messages.length > SUMMARIZE_THRESHOLD) {
            logger.info({ route: "summarize", messageCount: state.messages.length }, "shouldContinue → summarize");
            return "summarize_conversation";
        }
        logger.info({
            route: "__end__",
            messageCount: state.messages.length,
            lastMessageType: lastMessage?.constructor?.name,
        }, "shouldContinue → __end__");
        return "__end__";
    };

    // --- Custom HITL tool node (replaces ToolNode) ---
    const toolsByName = new Map<string, DynamicStructuredTool>();
    for (const tool of langchainTools) {
        toolsByName.set(tool.name, tool);
    }

    const humanReviewToolNode = async (state: typeof AgentState.State) => {
        // Sync planning state so tools can read/write it
        currentTodos = state.todos || [];
        const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
        const toolCalls = lastMessage.tool_calls ?? [];

        logger.info({
            toolCallCount: toolCalls.length,
            toolCallNames: toolCalls.map(tc => tc.name),
            messageCount: state.messages.length,
        }, "Tool node executing");

        const results: ToolMessage[] = [];
        for (const tc of toolCalls) {
            // Decision confirmation — interrupt for user approval
            if (tc.name === "ask_user_confirmation") {
                const response = interrupt({
                    type: "confirmation",
                    question: tc.args.question as string,
                    context: tc.args.context as string | undefined,
                }) as { decisions: Array<{ type: string; message?: string }> };

                const decision = response.decisions?.[0] || { type: "approve" };

                if (decision.type === "reject") {
                    results.push(new ToolMessage({
                        content: `User rejected this action.${decision.message ? ` Reason: ${decision.message}` : ""} Do not proceed with the proposed action.`,
                        tool_call_id: tc.id!,
                        name: tc.name,
                    }));
                } else {
                    results.push(new ToolMessage({
                        content: `User approved.${decision.message ? ` Note: ${decision.message}` : ""} Proceed with the action.`,
                        tool_call_id: tc.id!,
                        name: tc.name,
                    }));
                }
                continue;
            }

            // All other tools execute directly — no permission gates
            const tool = toolsByName.get(tc.name);
            if (!tool) {
                results.push(new ToolMessage({
                    content: `Tool "${tc.name}" not found`,
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
                continue;
            }

            try {
                const result = await tool.invoke(tc.args);
                const resultContent = typeof result === "string" ? result : JSON.stringify(result);
                logger.info({
                    toolName: tc.name,
                    resultLength: resultContent.length,
                    resultPreview: resultContent.slice(0, 300),
                }, "Tool executed successfully");
                results.push(new ToolMessage({
                    content: resultContent,
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
            } catch (error) {
                const errMsg = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
                logger.error({ toolName: tc.name, error: errMsg }, "Tool execution failed");
                results.push(new ToolMessage({
                    content: errMsg,
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
            }
        }

        return { messages: results, todos: currentTodos };
    };

    const graph = new StateGraph(AgentState)
        .addNode("agent", agentNode)
        .addNode("summarize_conversation", summarizeConversation);

    if (langchainTools.length > 0) {
        graph
            .addNode("tools", humanReviewToolNode)
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("tools", "agent")
            .addEdge("summarize_conversation", "__end__");
    } else {
        graph
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("summarize_conversation", "__end__");
    }

    const checkpointer = await getCheckpointer();

    const compiled = graph.compile({ checkpointer });

    // Cache compiled graph for subsequent messages in this session
    graphCache.set(cacheKey, {
        graph: compiled,
        browserEventRef,
        timestamp: Date.now(),
    });
    logger.info({ agentId, cacheKey }, "Agent graph compiled and cached");

    return compiled;
}
