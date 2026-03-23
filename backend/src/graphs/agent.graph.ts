import { StateGraph, Annotation, MessagesAnnotation, interrupt } from "@langchain/langgraph";
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
 */
function sanitizeMessagesForProvider(messages: BaseMessage[]): BaseMessage[] {
    const toolCallIds = new Set<string>();
    const toolResponseIds = new Set<string>();

    for (const msg of messages) {
        if (msg instanceof AIMessage && msg.tool_calls?.length) {
            for (const tc of msg.tool_calls) {
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

    logger.warn({
        orphanedResponses: orphanedResponses.size,
        orphanedCalls: orphanedCalls.size,
    }, "Sanitizing orphaned tool call/response messages");

    const result: BaseMessage[] = [];
    for (const msg of messages) {
        if (msg instanceof ToolMessage && msg.tool_call_id && orphanedResponses.has(msg.tool_call_id)) {
            continue;
        }

        if (msg instanceof AIMessage && msg.tool_calls?.length) {
            const validCalls = msg.tool_calls.filter(tc => !tc.id || !orphanedCalls.has(tc.id));
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
            if (validCalls.length < msg.tool_calls.length) {
                result.push(new AIMessage({
                    content: msg.content,
                    tool_calls: validCalls,
                    id: msg.id,
                }));
                continue;
            }
        }

        result.push(msg);
    }

    return result;
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

export async function createAgentGraph(
    agentId: string,
    workspaceId: string,
    userId?: string,
    onBrowserEvent?: BrowserAgentEventEmitter,
    chatSessionId?: string
) {
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

    // --- 2. Agent delegation tools ---
    const delegateAgentIds = allowedAgentIds.filter((id) => id !== agentId);
    const connectedAgents: ConnectedAgent[] = [];

    for (const targetAgentId of delegateAgentIds) {
        try {
            const targetAgent = await agentRepository.findById(targetAgentId, workspaceId);
            if (targetAgent) {
                const agentTool = await buildAgentCallerTool(
                    agentId,
                    targetAgentId,
                    workspaceId
                );
                if (agentTool) {
                    langchainTools.push(agentTool);
                    connectedAgents.push({
                        id: targetAgent.id,
                        name: targetAgent.name,
                        role: targetAgent.systemPrompt?.split("\n")[0] || "General Assistant",
                    });
                }
            }
        } catch (error) {
            logger.warn(
                { error, targetAgentId },
                "Failed to build agent caller tool, skipping"
            );
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
    let hasBrowser = false;
    const browserType = agent.browserType || "cloud";

    if (browserType === "cloud") {
        // Cloud browser: autonomous sub-agent with internal browser tools
        try {
            const browserAgentTool = await buildBrowserAgentTool(
                agentId,
                workspaceId,
                modelId,
                modelMultiplier,
                agentTemperature,
                onBrowserEvent,
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
                onBrowserEvent
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

    // --- 5. Fetch KB metadata for prompt builder ---
    const kbCapabilities: KBCapability[] = [];
    if (allowedKbIds.length > 0) {
        try {
            const kbs = await kbRepository.findKBsByIds(allowedKbIds, workspaceId);
            for (const kb of kbs) {
                const docs = await kbRepository.findDocumentsByKB(kb.id, workspaceId);
                kbCapabilities.push({
                    name: kb.name,
                    description: kb.description,
                    documentCount: docs.length,
                });
            }
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

    const agentNode = async (state: typeof AgentState.State) => {
        // Sync planning state from graph state
        currentTodos = state.todos || [];

        // --- Credit check BEFORE LLM call ---
        const estimatedCost = calculateCreditCost({
            action: "chat_message",
            modelMultiplier,
        });
        const creditCheck = await checkCredits(workspaceId, estimatedCost);
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
        if (userId) {
            try {
                const memories = await memoryRepository.findByUser(workspaceId, agentId, userId);
                if (memories.length > 0) {
                    const memoryLines = memories
                        .map((m) => `- [${m.category}] ${m.content}`)
                        .join("\n");
                    systemPromptParts.push(
                        `## Long-term Memories About This User\n` +
                        `These are facts and preferences you previously saved about this user:\n${memoryLines}`
                    );
                }
            } catch (error) {
                logger.warn({ error }, "Failed to load long-term memories");
            }
        }

        // 1. KB context (RAG) — with credit deduction
        if (allowedKbIds.length > 0) {
            const lastUserMsg = [...state.messages]
                .reverse()
                .find((m) => m instanceof HumanMessage);
            if (lastUserMsg && typeof lastUserMsg.content === "string") {
                try {
                    const results = await kbService.queryKB(
                        allowedKbIds,
                        lastUserMsg.content,
                        workspaceId,
                        5
                    );
                    if (results.length > 0) {
                        const context = results
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
                } catch (error) {
                    logger.warn(
                        { error, agentId },
                        "KB query failed, proceeding without context"
                    );
                }
            }
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
            systemPromptParts.push(`## Memory
You can remember important information about users across conversations using the \`save_memory\` tool.
- Save proactively when a user shares: their name, preferences, project details, important decisions, timezone, etc.
- Write memories as clear, standalone statements (e.g. "User's name is Alice", "User prefers concise responses").
- Don't save trivial or temporary information.
- Your previously saved memories (if any) are included in this prompt — use them to personalize responses.`);
        }

        const systemMsg = new SystemMessage(systemPromptParts.join("\n\n"));
        let response;
        try {
            logger.info({
                messageCount: state.messages.length,
                systemPromptLength: systemPromptParts.join("\n\n").length,
                toolCount: langchainTools.length,
                isClaudeDirect,
            }, "Invoking LLM");
            const sanitizedMessages = sanitizeMessagesForProvider(state.messages);
            response = await llmWithTools.invoke([systemMsg, ...sanitizedMessages]);
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
    const summarizeConversation = async (state: typeof AgentState.State) => {
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

        const response = await llm.invoke(allMessages);

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
            return "tools";
        }
        // Check if conversation is long enough to warrant summarization
        if (state.messages.length > SUMMARIZE_THRESHOLD) {
            return "summarize_conversation";
        }
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
                results.push(new ToolMessage({
                    content: typeof result === "string" ? result : JSON.stringify(result),
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
            } catch (error) {
                results.push(new ToolMessage({
                    content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
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

    return graph.compile({ checkpointer });
}
