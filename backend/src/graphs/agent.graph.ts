import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";
import { agentRepository } from "../repositories/agent.repository.ts";
import { permissionRepository } from "../repositories/permission.repository.ts";
import { toolRepository } from "../repositories/tool.repository.ts";
import { skillRepository } from "../repositories/skill.repository.ts";
import { kbService } from "../services/kb.service.ts";
import { buildAgentCallerTool } from "../lib/agent-tool.ts";
import { integrationRepository } from "../repositories/integration.repository.ts";
import { getComposioClient } from "../lib/composio.ts";
import { logger } from "../lib/logger.ts";
import { HumanMessage } from "@langchain/core/messages";

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

/**
 * Determine if a model ID is an OpenRouter model.
 * OpenRouter model IDs follow the format "provider/model-name" (e.g. "google/gemini-2.5-pro-preview").
 */
function isOpenRouterModel(modelId: string): boolean {
    return modelId.includes("/");
}

export async function createAgentGraph(
    agentId: string,
    workspaceId: string
) {
    const agent = await agentRepository.findById(agentId, workspaceId);
    if (!agent) throw new Error("Agent not found");

    // Determine configuration based on model ID format
    const useOpenRouter = isOpenRouterModel(agent.model);

    if (useOpenRouter && !process.env.OPENROUTER_KEY) {
        throw new Error("OPENROUTER_KEY is not set in environment");
    }

    const llm = new ChatOpenAI({
        model: agent.model,
        temperature: agent.temperature ?? 0.7,
        streaming: true,
        apiKey: useOpenRouter ? process.env.OPENROUTER_KEY : process.env.OPENAI_API_KEY,
        configuration: useOpenRouter
            ? {
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: process.env.OPENROUTER_KEY,
                defaultHeaders: {
                    "HTTP-Referer": "https://pushable.ai",
                    "X-Title": "Pushable AI",
                },
            }
            : {
                apiKey: process.env.OPENAI_API_KEY,
            },
    });

    // --- Collect tools based on agent permissions ---
    const allowedToolIds = await permissionRepository.getAllowedResourceIds(
        agentId,
        workspaceId,
        "tool"
    );

    const langchainTools: DynamicStructuredTool[] = [];
    const mcpClients: MultiServerMCPClient[] = [];

    if (allowedToolIds.length > 0) {
        const dbTools = await toolRepository.findByIds(allowedToolIds);

        for (const tool of dbTools) {
            const config = tool.config as Record<string, unknown>;

            if (tool.type === "function") {
                // Create a LangChain tool that calls the webhook URL
                const webhookUrl = config.webhookUrl as string;
                if (!webhookUrl) {
                    logger.warn({ toolId: tool.id }, "Function tool missing webhookUrl, skipping");
                    continue;
                }

                const method = ((config.method as string) || "POST").toUpperCase();

                // Parse {{var}} placeholders from URL to build dynamic schema
                const varPattern = /\{\{(\w+)\}\}/g;
                const urlVars: string[] = [];
                let match;
                while ((match = varPattern.exec(webhookUrl)) !== null) {
                    if (!urlVars.includes(match[1])) {
                        urlVars.push(match[1]);
                    }
                }

                // Build schema: one field per URL variable + optional body input
                const schemaFields: Record<string, z.ZodTypeAny> = {};
                for (const v of urlVars) {
                    schemaFields[v] = z.string().describe(`Value for {{${v}}} in the URL`);
                }
                // Always include a general input/body field for POST payloads
                if (method === "POST") {
                    schemaFields["input"] = z.string().describe("The input/body to send to the tool").optional();
                }
                // If no URL vars and not POST, add a fallback input field
                if (urlVars.length === 0 && method !== "POST") {
                    schemaFields["input"] = z.string().describe("The input to send to the tool").optional();
                }

                const functionTool = new DynamicStructuredTool({
                    name: tool.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
                    description: tool.description || `Execute ${tool.name}`,
                    schema: z.object(schemaFields),
                    func: async (params) => {
                        // Interpolate {{var}} placeholders in the URL
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
            } else if (tool.type === "mcp") {
                // Use MultiServerMCPClient to connect to MCP server
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

                    // Filter by toolNames if provided
                    const toolNames = config.toolNames as string[] | undefined;
                    const filtered = toolNames && toolNames.length > 0
                        ? mcpToolsList.filter((t) => toolNames.includes(t.name))
                        : mcpToolsList;

                    for (const mcpTool of filtered) {
                        langchainTools.push(mcpTool as DynamicStructuredTool);
                    }
                } catch (error) {
                    // MCP failures must never crash the agent run
                    logger.warn(
                        { error, toolId: tool.id, mcpUrl },
                        "Failed to connect to MCP server, skipping tool"
                    );
                }
            }
        }
    }

    // --- Collect agent-as-tool (agent delegation) ---
    const allowedAgentIds = await permissionRepository.getAllowedResourceIds(
        agentId,
        workspaceId,
        "agent"
    );

    // Filter out self-calling
    const delegateAgentIds = allowedAgentIds.filter((id) => id !== agentId);

    for (const targetAgentId of delegateAgentIds) {
        try {
            const agentTool = await buildAgentCallerTool(
                agentId,
                targetAgentId,
                workspaceId
            );
            if (agentTool) {
                langchainTools.push(agentTool);
            }
        } catch (error) {
            logger.warn(
                { error, targetAgentId },
                "Failed to build agent caller tool, skipping"
            );
        }
    }

    // --- Collect Composio integration tools ---
    let composioToolCount = 0;
    try {
        const agentIntegrations = await integrationRepository.findByAgent(
            agentId,
            workspaceId
        );
        const activeIntegrations = agentIntegrations.filter(
            (i) => i.status === "active"
        );

        if (activeIntegrations.length > 0) {
            const composio = getComposioClient();
            const toolkitSlugs = activeIntegrations.map(
                (i) => i.composioToolkitSlug
            );

            const session = await composio.create(workspaceId, {
                toolkits: toolkitSlugs,
            });
            const composioTools = await session.tools();

            if (Array.isArray(composioTools)) {
                for (const tool of composioTools) {
                    langchainTools.push(tool as unknown as DynamicStructuredTool);
                }
                composioToolCount = composioTools.length;
            }
        }
    } catch (error) {
        logger.warn(
            { error, agentId },
            "Failed to load Composio tools, proceeding without them"
        );
    }

    // --- Collect KB IDs for RAG ---
    const allowedKbIds = await permissionRepository.getAllowedResourceIds(
        agentId,
        workspaceId,
        "kb"
    );

    // --- Collect Skills ---
    const allowedSkillIds = await permissionRepository.getAllowedResourceIds(
        agentId,
        workspaceId,
        "skill"
    );
    const permittedSkills = await skillRepository.findByIds(
        allowedSkillIds,
        workspaceId
    );

    logger.info(
        {
            agentId,
            toolCount: langchainTools.length,
            delegateAgents: delegateAgentIds.length,
            composioTools: composioToolCount,
            kbCount: allowedKbIds.length,
            skillCount: permittedSkills.length,
        },
        "Agent graph created"
    );

    // Bind tools to LLM if any exist
    const llmWithTools = langchainTools.length > 0
        ? llm.bindTools(langchainTools)
        : llm;

    // Build skills section once (static across turns)
    let skillsSection = "";
    if (permittedSkills.length > 0) {
        const skillLines = permittedSkills
            .map((s) => `- ${s.name}: ${s.instructions}`)
            .join("\n");
        skillsSection = `\n\nSkills you must apply:\n${skillLines}`;
    }

    const agentNode = async (state: typeof MessagesAnnotation.State) => {
        // Build dynamic system prompt
        let systemPromptParts: string[] = [];

        // 1. KB context (RAG) — query using latest user message
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
                    }
                } catch (error) {
                    logger.warn(
                        { error, agentId },
                        "KB query failed, proceeding without context"
                    );
                }
            }
        }

        // 2. Agent's base system prompt
        systemPromptParts.push(
            agent.systemPrompt ?? "You are a helpful assistant."
        );

        // 3. Skills instructions
        if (skillsSection) {
            systemPromptParts.push(skillsSection);
        }

        const systemMsg = new SystemMessage(systemPromptParts.join("\n\n"));
        const response = await llmWithTools.invoke([systemMsg, ...state.messages]);
        return { messages: [response] };
    };

    // Route function: if last message has tool_calls, go to tools node; else end
    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
        const lastMessage = state.messages[state.messages.length - 1];
        if (
            lastMessage &&
            "tool_calls" in lastMessage &&
            (lastMessage as AIMessage).tool_calls &&
            (lastMessage as AIMessage).tool_calls!.length > 0
        ) {
            return "tools";
        }
        return "__end__";
    };

    const graph = new StateGraph(MessagesAnnotation)
        .addNode("agent", agentNode);

    if (langchainTools.length > 0) {
        const toolNode = new ToolNode(langchainTools);
        graph
            .addNode("tools", toolNode)
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("tools", "agent");
    } else {
        graph
            .addEdge("__start__", "agent")
            .addEdge("agent", "__end__");
    }

    const checkpointer = await getCheckpointer();

    return graph.compile({ checkpointer });
}
