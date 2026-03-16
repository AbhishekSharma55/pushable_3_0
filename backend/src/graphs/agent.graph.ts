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
import { logger } from "../lib/logger.ts";

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
                // Create a LangChain tool that POSTs to the webhook URL
                const webhookUrl = config.webhookUrl as string;
                if (!webhookUrl) {
                    logger.warn({ toolId: tool.id }, "Function tool missing webhookUrl, skipping");
                    continue;
                }

                const functionTool = new DynamicStructuredTool({
                    name: tool.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
                    description: tool.description || `Execute ${tool.name}`,
                    schema: z.object({
                        input: z.string().describe("The input to send to the tool"),
                    }),
                    func: async ({ input }) => {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 30_000);
                        try {
                            const response = await fetch(webhookUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ input }),
                                signal: controller.signal,
                            });
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

    logger.info(
        { agentId, toolCount: langchainTools.length },
        "Agent graph created with tools"
    );

    // Bind tools to LLM if any exist
    const llmWithTools = langchainTools.length > 0
        ? llm.bindTools(langchainTools)
        : llm;

    const agentNode = async (state: typeof MessagesAnnotation.State) => {
        const systemMsg = new SystemMessage(
            agent.systemPrompt ?? "You are a helpful assistant."
        );
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
