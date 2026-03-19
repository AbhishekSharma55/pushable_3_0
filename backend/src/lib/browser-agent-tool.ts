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

/**
 * Sanitize the browser agent's final response to strip any leaked
 * DOM/HTML/page-state content that shouldn't be shown to the user.
 */
function sanitizeBrowserResponse(text: string): string {
    let cleaned = text;

    // Remove lines that look like page state element listings:
    //   [0] <tag ...> "label"
    //   [12] <input type="text" name="q"> "Search"
    cleaned = cleaned.replace(
        /^\s*\[?\d+\]?\s*<[a-z][a-z0-9]*[^>]*>.*$/gm,
        ""
    );

    // Remove page state headers that may have been echoed
    cleaned = cleaned.replace(
        /^\s*\[Current Page State\].*$/gm,
        ""
    );
    cleaned = cleaned.replace(
        /^\s*Interactive elements\s*\(\d+\)\s*:?\s*$/gm,
        ""
    );
    cleaned = cleaned.replace(
        /^\s*Page:\s+.+$/gm,
        ""
    );
    cleaned = cleaned.replace(
        /^\s*URL:\s+https?:\/\/.+$/gm,
        ""
    );
    cleaned = cleaned.replace(
        /^\s*Scroll:\s+\d+.*$/gm,
        ""
    );

    // Remove raw HTML blocks (anything with multiple HTML tags on consecutive lines)
    cleaned = cleaned.replace(
        /(<[a-z][a-z0-9]*[\s>][\s\S]*?<\/[a-z][a-z0-9]*>)/gi,
        ""
    );

    // Collapse excessive blank lines left by removals
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

    return cleaned.trim();
}

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
 * Key architectural feature: before every LLM turn, the agent auto-fetches
 * the current page state (interactive elements with index numbers) and
 * injects it as context. The LLM always "sees" the page before deciding.
 */
export async function buildBrowserAgentTool(
    agentId: string,
    workspaceId: string,
    modelId: string,
    modelMultiplier: number,
    temperature: number,
    onEvent?: BrowserAgentEventEmitter,
    chatSessionId?: string
): Promise<DynamicStructuredTool | null> {
    // Get browser tools + page state helper (scoped to chat session)
    const browserResult = await buildBrowserTools(agentId, workspaceId, chatSessionId);
    if (!browserResult) return null;

    const { tools: browserTools, getPageState } = browserResult;

    // Wrap each browser tool with credit deduction
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

    // Pre-build the tools-by-name map
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
            "extract data, handle CAPTCHAs, and return a clean summary. " +
            "Include the target URL and expected outcome in your instruction. " +
            "The result is a human-readable summary — relay it to the user as-is, " +
            "never include raw HTML, DOM elements, or page state details.",
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
                // Always use Gemini Flash for browser agent — optimised for speed + vision
                const BROWSER_AGENT_MODEL = "google/gemini-3-flash-preview";
                const { llm } = createLLM({ modelId: BROWSER_AGENT_MODEL, temperature });
                const llmWithTools = llm.bindTools(wrappedBrowserTools);

                // --- Agent node (auto-injects page state before LLM call) ---
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

                    // ── Auto-inject current page state ──
                    // Fetch interactive elements before every LLM decision
                    let pageStateMsg: HumanMessage | null = null;
                    try {
                        const pageState = await getPageState();
                        if (
                            pageState &&
                            !pageState.startsWith("Error") &&
                            !pageState.startsWith("Browser action failed")
                        ) {
                            pageStateMsg = new HumanMessage(
                                `[Current Page State]\n${pageState}`
                            );
                        }
                    } catch (err) {
                        logger.warn(
                            { err },
                            "Browser agent: failed to fetch page state"
                        );
                    }

                    // Build messages: system + page state + conversation
                    const systemMsg = new SystemMessage(systemPrompt);
                    const messages = pageStateMsg
                        ? [systemMsg, pageStateMsg, ...state.messages]
                        : [systemMsg, ...state.messages];

                    const response = await llmWithTools.invoke(messages);

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
                const rawResponse =
                    typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);

                // Sanitize: strip any leaked DOM/HTML/page-state content
                const responseText = sanitizeBrowserResponse(rawResponse);

                logger.info(
                    {
                        agentId,
                        invocationId,
                        responseLength: responseText.length,
                        rawLength: rawResponse.length,
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
