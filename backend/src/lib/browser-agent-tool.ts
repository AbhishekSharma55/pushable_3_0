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
import { buildBrowserTools } from "../tools/browser.tools.ts";
import { buildBrowserAgentPrompt } from "./browser-agent-prompt.ts";
import { logger } from "./logger.ts";
import { calculateCreditCost, deductCredits } from "./credit-engine.ts";

// ---- Event emitter interface for real-time SSE streaming ----

export interface BrowserAgentEvent {
    type: "tool_start" | "tool_end" | "thinking";
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: string;
    content?: string;
}

export type BrowserAgentEventEmitter = (event: BrowserAgentEvent) => void;

// ---- Internal graph state ----

const BrowserAgentState = Annotation.Root({
    ...MessagesAnnotation.spec,
});

/** Max supersteps for the browser agent graph (~16 tool-use iterations) */
const BROWSER_AGENT_RECURSION_LIMIT = 50;

/**
 * Build a single "browser_agent" tool that wraps an internal, autonomous
 * browser-automation agent.  The calling agent delegates browser work
 * via natural-language instructions; this tool spins up a lightweight
 * LangGraph, executes the task, and returns the result.
 *
 * When `onEvent` is provided, internal tool calls and intermediate AI
 * thinking are emitted in real-time so the SSE stream stays alive and
 * the frontend can show progress.
 */
export async function buildBrowserAgentTool(
    agentId: string,
    workspaceId: string,
    modelId: string,
    modelMultiplier: number,
    temperature: number,
    onEvent?: BrowserAgentEventEmitter
): Promise<DynamicStructuredTool | null> {
    // Get raw browser tools for this agent's profile / session
    const browserTools = await buildBrowserTools(agentId, workspaceId);
    if (browserTools.length === 0) return null;

    // Wrap each browser tool with credit deduction (same pattern as main graph)
    const wrappedBrowserTools: DynamicStructuredTool[] = browserTools.map(
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
                            "Browser agent: browser action credit deduction failed"
                        )
                    );
                    return bt.func(params);
                },
            })
    );

    const systemPrompt = buildBrowserAgentPrompt();

    // Pre-build the tools-by-name map (stable across invocations)
    const toolsByName = new Map<string, DynamicStructuredTool>();
    for (const tool of wrappedBrowserTools) {
        toolsByName.set(tool.name, tool);
    }

    // ---------------------------------------------------------------
    // Return the single tool the calling agent sees
    // ---------------------------------------------------------------
    return new DynamicStructuredTool({
        name: "browser_agent",
        description:
            "Delegate a browser automation task to the Browser Agent. " +
            "Describe what you want done in natural language — the browser agent " +
            "will autonomously navigate websites, interact with pages, fill forms, " +
            "extract data, handle CAPTCHAs, and return the result. " +
            "Include the target URL and expected outcome in your instruction.",
        schema: z.object({
            instruction: z
                .string()
                .describe(
                    "Natural language instruction for the browser agent. " +
                        "Be specific: which website, what to do, what data to extract or action to perform."
                ),
        }),
        func: async ({ instruction }) => {
            const invocationId = `browser-agent-${agentId}-${Date.now()}`;

            logger.info(
                {
                    agentId,
                    invocationId,
                    instructionLength: instruction.length,
                },
                "Browser agent invocation started"
            );

            try {
                // Fresh LLM per invocation (stateless)
                const { llm } = createLLM({ modelId, temperature });
                const llmWithTools = llm.bindTools(wrappedBrowserTools);

                // --- Agent node ---
                const agentNode = async (
                    state: typeof BrowserAgentState.State
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
                            modelId,
                            source: "browser_agent",
                        },
                    }).catch((err) =>
                        logger.warn(
                            { err },
                            "Browser agent: LLM credit deduction failed"
                        )
                    );

                    const systemMsg = new SystemMessage(systemPrompt);
                    const response = await llmWithTools.invoke([
                        systemMsg,
                        ...state.messages,
                    ]);

                    // Emit intermediate thinking (AI content when it also has tool_calls)
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

                        // Emit thinking when the agent has both text + tool_calls
                        // (intermediate reasoning before the next action)
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
                    state: typeof BrowserAgentState.State
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
                            // Emit not-found as a completed tool call
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
                    state: typeof BrowserAgentState.State
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
                const graph = new StateGraph(BrowserAgentState)
                    .addNode("agent", agentNode)
                    .addNode("tools", toolNode)
                    .addEdge("__start__", "agent")
                    .addConditionalEdges("agent", shouldContinue)
                    .addEdge("tools", "agent")
                    .compile();

                const result = await graph.invoke(
                    { messages: [new HumanMessage(instruction)] },
                    { recursionLimit: BROWSER_AGENT_RECURSION_LIMIT }
                );

                // Extract the final AI response
                const messages = result.messages;
                const lastMsg = messages[messages.length - 1];
                const responseText =
                    typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);

                logger.info(
                    {
                        agentId,
                        invocationId,
                        responseLength: responseText.length,
                        totalMessages: messages.length,
                    },
                    "Browser agent invocation completed"
                );

                return responseText;
            } catch (error) {
                const errMsg =
                    error instanceof Error ? error.message : "Unknown error";
                logger.error(
                    { agentId, invocationId, error: errMsg },
                    "Browser agent invocation failed"
                );
                return `Browser agent failed: ${errMsg}`;
            }
        },
    });
}
