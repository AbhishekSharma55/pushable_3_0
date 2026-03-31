import {
    StateGraph,
    Annotation,
    MessagesAnnotation,
} from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";
import {
    SystemMessage,
    AIMessage,
    HumanMessage,
    ToolMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { createLLM } from "./gateway.ts";
import { buildExtensionBrowserTools } from "./extension-bridge-client.ts";
import { buildExtensionBrowserAgentPrompt } from "./extension-browser-agent-prompt.ts";
import { logger } from "./logger.ts";
import { calculateCreditCost, deductCredits } from "./credit-engine.ts";
import type { BrowserAgentEventEmitter } from "./browser-agent-tool.ts";

// ---- Internal graph state ----

const ExtBrowserAgentState = Annotation.Root({
    ...MessagesAnnotation.spec,
});

/** Max supersteps for the extension browser agent graph.
 *  30 handles complex multi-step tasks with Gemini Flash (cheap tokens).
 *  Each "step" = one LLM call + tool execution. Most tasks need 4-10 steps. */
const EXT_BROWSER_AGENT_RECURSION_LIMIT = 30;

/**
 * Build a single "extension_browser_agent" tool that wraps an internal,
 * autonomous browser-automation agent using the Chrome extension.
 *
 * Mirrors the cloud `buildBrowserAgentTool` architecture:
 * - The calling agent delegates browser work via natural-language instructions
 * - This tool spins up a lightweight LangGraph sub-agent
 * - The sub-agent uses ext_browser_* tools to control the user's real Chrome
 * - Returns a clean summary to the calling agent
 */
export function buildExtensionBrowserAgentTool(
    agentId: string,
    workspaceId: string,
    modelMultiplier: number,
    temperature: number,
    onEvent?: BrowserAgentEventEmitter,
    browserModelId?: string
): DynamicStructuredTool | null {
    // Get extension browser tools
    let extTools: DynamicStructuredTool[];
    try {
        extTools = buildExtensionBrowserTools(workspaceId);
    } catch (error) {
        logger.warn({ error, agentId }, "Failed to build extension browser tools");
        return null;
    }

    if (extTools.length === 0) return null;

    // Wrap each tool with credit deduction
    const wrappedTools: DynamicStructuredTool[] = extTools.map(
        (bt) =>
            new DynamicStructuredTool({
                name: bt.name,
                description: bt.description,
                schema: bt.schema,
                func: async (params) => {
                    const cost = calculateCreditCost({
                        action: "browser_action",
                    });
                    deductCredits({
                        workspaceId,
                        amount: cost,
                        type: "browser_action",
                        metadata: { agentId, action: bt.name },
                    }).catch((err) =>
                        logger.warn(
                            { err },
                            "Extension browser agent: browser action credit deduction failed"
                        )
                    );
                    return bt.func(params);
                },
            })
    );

    const systemPrompt = buildExtensionBrowserAgentPrompt();

    // Pre-build the tools-by-name map
    const toolsByName = new Map<string, DynamicStructuredTool>();
    for (const tool of wrappedTools) {
        toolsByName.set(tool.name, tool);
    }

    // ---------------------------------------------------------------
    // Return the single tool the calling agent sees
    // ---------------------------------------------------------------
    return new DynamicStructuredTool({
        name: "extension_browser_agent",
        description:
            "Delegate a browser automation task to the Extension Browser Agent. " +
            "This agent controls the user's real Chrome browser via a Chrome extension. " +
            "Describe what you want done in natural language — the extension browser agent " +
            "will autonomously navigate websites, interact with pages, fill forms, " +
            "extract data, and return a clean summary. " +
            "Include the target URL and expected outcome in your instruction. " +
            "The result is a human-readable summary — relay it to the user as-is, " +
            "never include raw HTML, DOM elements, or CSS selectors.",
        schema: z.object({
            instruction: z
                .string()
                .describe(
                    "Natural language instruction for the extension browser agent. " +
                        "Be specific: which website, what to do, what data to extract or action to perform."
                ),
        }),
        func: async ({ instruction }) => {
            const invocationId = `ext-browser-agent-${agentId}-${Date.now()}`;

            logger.info(
                {
                    agentId,
                    invocationId,
                    instructionLength: instruction.length,
                },
                "Extension browser agent invocation started"
            );

            try {
                // Use model from admin panel system_settings, fallback to Gemini Flash
                const resolvedModel = browserModelId || "google/openai/gpt-4o-mini";
                logger.info({ modelId: resolvedModel }, "Extension browser agent creating LLM with model");
                const { llm } = createLLM({ modelId: resolvedModel, temperature });
                const llmWithTools = llm.bindTools(wrappedTools);

                // --- Agent node ---
                const agentNode = async (
                    state: typeof ExtBrowserAgentState.State
                ) => {
                    // Credit deduction for LLM call
                    const cost = calculateCreditCost({
                        action: "chat_message",
                        modelMultiplier,
                    });
                    deductCredits({
                        workspaceId,
                        amount: cost,
                        type: "chat_message",
                        metadata: {
                            agentId,
                            modelId: resolvedModel,
                            source: "extension_browser_agent",
                        },
                    }).catch((err) =>
                        logger.warn(
                            { err },
                            "Extension browser agent: LLM credit deduction failed"
                        )
                    );

                    const systemMsg = new SystemMessage(systemPrompt);
                    const messages = [systemMsg, ...state.messages];

                    // LOG: what the LLM sees (last few messages)
                    const recentMsgs = state.messages.slice(-4);
                    for (const m of recentMsgs) {
                        const role = m._getType?.() || 'unknown';
                        const content = typeof m.content === 'string' ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500);
                        logger.info({ role, content }, `🧠 LLM INPUT [${role}]`);
                    }

                    const response = await llmWithTools.invoke(messages);

                    // LOG: what the LLM decided
                    const aiResponse = response as AIMessage;
                    if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
                        for (const tc of aiResponse.tool_calls) {
                            logger.info({ tool: tc.name, args: tc.args }, `🤖 LLM DECISION → ${tc.name}`);
                        }
                    } else {
                        const textOut = typeof aiResponse.content === 'string' ? aiResponse.content.slice(0, 300) : JSON.stringify(aiResponse.content).slice(0, 300);
                        logger.info({ content: textOut }, `🤖 LLM FINAL RESPONSE`);
                    }

                    // Emit intermediate thinking
                    if (onEvent) {
                        const aiMsg = response as AIMessage;
                        const hasToolCalls =
                            aiMsg.tool_calls && aiMsg.tool_calls.length > 0;
                        const textContent =
                            typeof aiMsg.content === "string"
                                ? aiMsg.content
                                : Array.isArray(aiMsg.content)
                                    ? (
                                          aiMsg.content as Array<{
                                              type: string;
                                              text: string;
                                          }>
                                      )
                                          .filter((b) => b.type === "text")
                                          .map((b) => b.text)
                                          .join("")
                                    : "";

                        if (hasToolCalls && textContent) {
                            onEvent({
                                type: "thinking",
                                content: textContent,
                            });
                        }
                    }

                    return { messages: [response] };
                };

                // --- Tool node (no HITL — internal agent) ---
                const toolNode = async (
                    state: typeof ExtBrowserAgentState.State
                ) => {
                    const lastMessage = state.messages[
                        state.messages.length - 1
                    ] as AIMessage;
                    const toolCalls = lastMessage.tool_calls ?? [];
                    const results: ToolMessage[] = [];

                    for (const tc of toolCalls) {
                        const tool = toolsByName.get(tc.name);
                        if (!tool) {
                            const errContent = `Tool "${tc.name}" not found`;
                            onEvent?.({
                                type: "tool_start",
                                toolCallId: tc.id!,
                                toolName: tc.name,
                                args: tc.args as Record<string, unknown>,
                            });
                            onEvent?.({
                                type: "tool_end",
                                toolCallId: tc.id!,
                                toolName: tc.name,
                                result: errContent,
                            });
                            results.push(
                                new ToolMessage({
                                    content: errContent,
                                    tool_call_id: tc.id!,
                                    name: tc.name,
                                })
                            );
                            continue;
                        }

                        // Emit tool_start
                        onEvent?.({
                            type: "tool_start",
                            toolCallId: tc.id!,
                            toolName: tc.name,
                            args: tc.args as Record<string, unknown>,
                        });

                        let resultContent: string;
                        try {
                            const result = await tool.invoke(tc.args);
                            resultContent =
                                typeof result === "string"
                                    ? result
                                    : JSON.stringify(result);
                        } catch (error) {
                            resultContent = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
                        }

                        // LOG: tool result (truncated)
                        logger.info({ tool: tc.name, resultLength: resultContent.length, result: resultContent.slice(0, 800) }, `📦 TOOL RESULT [${tc.name}]`);

                        // Emit tool_end
                        onEvent?.({
                            type: "tool_end",
                            toolCallId: tc.id!,
                            toolName: tc.name,
                            result: resultContent,
                        });

                        results.push(
                            new ToolMessage({
                                content: resultContent,
                                tool_call_id: tc.id!,
                                name: tc.name,
                            })
                        );
                    }

                    return { messages: results };
                };

                // --- Router ---
                const shouldContinue = (
                    state: typeof ExtBrowserAgentState.State
                ) => {
                    const lastMessage = state.messages[
                        state.messages.length - 1
                    ];
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

                // --- Compile & run (no checkpointer — ephemeral) ---
                const graph = new StateGraph(ExtBrowserAgentState)
                    .addNode("agent", agentNode)
                    .addNode("tools", toolNode)
                    .addEdge("__start__", "agent")
                    .addConditionalEdges("agent", shouldContinue)
                    .addEdge("tools", "agent")
                    .compile();

                const result = await graph.invoke(
                    { messages: [new HumanMessage(instruction)] },
                    { recursionLimit: EXT_BROWSER_AGENT_RECURSION_LIMIT }
                );

                // Extract the final AI response
                const messages = result.messages;
                const lastMsg = messages[messages.length - 1];
                const rawResponse =
                    typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);

                logger.info(
                    {
                        agentId,
                        invocationId,
                        responseLength: rawResponse.length,
                        totalMessages: messages.length,
                    },
                    "Extension browser agent invocation completed"
                );

                return rawResponse.trim();
            } catch (error) {
                const errMsg =
                    error instanceof Error ? error.message : "Unknown error";
                logger.error(
                    { agentId, invocationId, error: errMsg },
                    "Extension browser agent invocation failed"
                );
                return `Extension browser agent failed: ${errMsg}`;
            }
        },
    });
}
