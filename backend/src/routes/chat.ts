import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, GraphRecursionError } from "@langchain/langgraph";
import { sessionService } from "../services/session.service.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { runRepository } from "../repositories/run.repository.ts";
import { createAgentGraph, getAgentDebugInfo } from "../graphs/agent.graph.ts";
import { runEventBus, type SSEEvent } from "../lib/run-event-bus.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { stripToolCallXml, stripToolCallXmlFinal } from "../lib/sanitize-llm-output.ts";
import type { BrowserAgentEventEmitter } from "../lib/browser-agent-tool.ts";
import { fileProcessingService, type ProcessedAttachment } from "../services/file-processing.service.ts";
import { openrouterService } from "../services/openrouter.service.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { bucketService } from "../services/bucket.service.ts";
import { createLLM } from "../lib/gateway.ts";

const AGENT_RECURSION_LIMIT = 50; // Safety net behind step_count-based graceful termination

const HELPER_TEXT_MODEL = "openai/gpt-4.1-nano";

// ─── Run abort registry ──────────────────────────────────────────────────────
// Tracks AbortControllers per runId so runs can be stopped via the stop endpoint.
const runAbortControllers = new Map<string, AbortController>();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const chatBodySchema = z.object({
    message: z.string().min(1, "Message is required"),
});

const approveBodySchema = z.object({
    decisions: z.array(
        z.object({
            type: z.enum(["approve", "edit", "reject"]),
            args: z.record(z.string(), z.unknown()).optional(),
            message: z.string().optional(),
        })
    ),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface StreamToolCall {
    id: string;
    name: string;
    args?: string;
    fullArgs?: Record<string, unknown>;
    type: string;
    status: string;
    result?: string;
}

interface StreamSegment {
    type: "text" | "tools";
    content?: string;
    toolCalls?: StreamToolCall[];
}

interface StreamResult {
    content: string;
    toolCalls: StreamToolCall[];
    segments: StreamSegment[];
    thinking: string;
    usage: { inputTokens: number; outputTokens: number };
}

// ─── Browser event handler (emits to RunEventBus) ────────────────────────────

function createBrowserEventHandler(
    runId: string,
    browserToolCalls: StreamToolCall[],
    browserSegments: StreamSegment[]
): BrowserAgentEventEmitter {
    return (event) => {
        if (event.type === "tool_start" && event.toolCallId && event.toolName) {
            const argsPreview = event.args
                ? Object.entries(event.args)
                      .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
                      .join(", ")
                      .slice(0, 150)
                : "";

            const toolCallEvent: StreamToolCall = {
                id: event.toolCallId,
                name: event.toolName,
                args: argsPreview,
                fullArgs: event.args,
                type: "tool",
                status: "running",
            };

            browserToolCalls.push(toolCallEvent);

            const lastSeg = browserSegments[browserSegments.length - 1];
            if (lastSeg && lastSeg.type === "tools") {
                lastSeg.toolCalls!.push(toolCallEvent);
            } else {
                browserSegments.push({ type: "tools", toolCalls: [toolCallEvent] });
            }

            runEventBus.emit(runId, {
                type: "toolCall",
                data: { toolCall: toolCallEvent },
                timestamp: Date.now(),
            });
        } else if (event.type === "tool_end" && event.toolCallId && event.toolName) {
            const resultText = event.result?.slice(0, 300) || "";

            const existing = browserToolCalls.find((t) => t.id === event.toolCallId);
            if (existing) {
                existing.status = "done";
                existing.result = resultText;
            }

            runEventBus.emit(runId, {
                type: "toolCall",
                data: {
                    toolCall: {
                        id: event.toolCallId,
                        name: event.toolName,
                        type: "tool",
                        status: "done",
                        result: resultText,
                    },
                },
                timestamp: Date.now(),
            });
        } else if (event.type === "thinking" && event.content) {
            runEventBus.emit(runId, {
                type: "browserAgentThinking",
                data: { browserAgentThinking: event.content },
                timestamp: Date.now(),
            });
        }
    };
}

// ─── Merge browser events into stream result ─────────────────────────────────

function mergeBrowserEvents(
    streamResult: StreamResult,
    browserToolCalls: StreamToolCall[],
    browserSegments: StreamSegment[]
): void {
    if (browserToolCalls.length === 0) return;

    streamResult.toolCalls.push(...browserToolCalls);

    const browserAgentSegIdx = streamResult.segments.findIndex(
        (s) =>
            s.type === "tools" &&
            s.toolCalls?.some((tc) => tc.name === "browser_agent")
    );

    if (browserAgentSegIdx >= 0) {
        streamResult.segments.splice(browserAgentSegIdx + 1, 0, ...browserSegments);
    } else {
        let lastTextIdx = -1;
        for (let i = streamResult.segments.length - 1; i >= 0; i--) {
            if (streamResult.segments[i].type === "text") {
                lastTextIdx = i;
                break;
            }
        }
        if (lastTextIdx >= 0) {
            streamResult.segments.splice(lastTextIdx, 0, ...browserSegments);
        } else {
            streamResult.segments.push(...browserSegments);
        }
    }
}

// ─── Process graph stream into events (emits to RunEventBus) ─────────────────

async function processGraphStream(
    stream: AsyncIterable<[unknown, ...unknown[]]>,
    runId: string
): Promise<StreamResult> {
    let fullContent = "";
    let fullThinking = "";
    const allToolCalls: StreamToolCall[] = [];
    const segments: StreamSegment[] = [];
    let lastSegmentType: "text" | "tools" | null = null;

    // Track token usage per graph step (max per step to handle cumulative reporters)
    const usageByStep = new Map<number, { input_tokens: number; output_tokens: number }>();

    for await (const [message, metadata] of stream) {
        if (!message) continue;

        // Skip messages from the summarize_conversation node — these are internal
        // summaries that should never be streamed to the user as chat content.
        const meta = metadata as Record<string, unknown> | undefined;
        if (meta?.langgraph_node === "summarize_conversation") continue;

        // Detect AI tool_calls
        const msgObj = message as Record<string, unknown>;

        // Capture token usage from AI message chunks
        const usageMeta = msgObj.usage_metadata as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usageMeta && (usageMeta.input_tokens || usageMeta.output_tokens)) {
            const step = (meta?.langgraph_step as number) ?? -1;
            const existing = usageByStep.get(step) ?? { input_tokens: 0, output_tokens: 0 };
            usageByStep.set(step, {
                input_tokens: Math.max(existing.input_tokens, usageMeta.input_tokens ?? 0),
                output_tokens: Math.max(existing.output_tokens, usageMeta.output_tokens ?? 0),
            });
        }
        const toolCalls = msgObj.tool_calls as
            | Array<{ id?: string; name: string; args?: Record<string, unknown> }>
            | undefined;

        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
            for (const tc of toolCalls) {
                const isAgent = tc.name.startsWith("agent_");
                const displayName = isAgent
                    ? `Delegating to ${tc.name.replace(/^agent_/, "").replace(/_/g, " ")}`
                    : tc.name;
                const argsPreview = tc.args
                    ? Object.entries(tc.args)
                          .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
                          .join(", ")
                          .slice(0, 150)
                    : "";

                const toolCallEvent: StreamToolCall = {
                    id: tc.id || `tc-${Date.now()}`,
                    name: displayName,
                    args: argsPreview,
                    fullArgs: tc.args,
                    type: isAgent ? "agent" : "tool",
                    status: "running",
                };

                allToolCalls.push(toolCallEvent);

                if (lastSegmentType === "tools" && segments.length > 0) {
                    (
                        segments[segments.length - 1] as {
                            type: "tools";
                            toolCalls: StreamToolCall[];
                        }
                    ).toolCalls.push(toolCallEvent);
                } else {
                    segments.push({ type: "tools", toolCalls: [toolCallEvent] });
                    lastSegmentType = "tools";
                }

                runEventBus.emit(runId, {
                    type: "toolCall",
                    data: { toolCall: toolCallEvent },
                    timestamp: Date.now(),
                });
            }
            continue;
        }

        // Detect tool responses
        if (msgObj.tool_call_id && typeof msgObj.tool_call_id === "string") {
            const toolName = (msgObj.name as string) || "tool";
            const isAgent = toolName.startsWith("agent_");
            const displayName = isAgent
                ? `Delegated to ${toolName.replace(/^agent_/, "").replace(/_/g, " ")}`
                : toolName;
            const resultText =
                typeof msgObj.content === "string"
                    ? isAgent
                        ? (msgObj.content as string).slice(0, 5000)
                        : (msgObj.content as string).slice(0, 300)
                    : "";

            const existing = allToolCalls.find((t) => t.id === msgObj.tool_call_id);
            if (existing) {
                existing.status = "done";
                existing.result = resultText;
                existing.name = displayName;
            }

            runEventBus.emit(runId, {
                type: "toolCall",
                data: {
                    toolCall: {
                        id: msgObj.tool_call_id,
                        name: displayName,
                        type: isAgent ? "agent" : "tool",
                        status: "done",
                        result: resultText,
                    },
                },
                timestamp: Date.now(),
            });
            continue;
        }

        // Stream AI content chunks
        if (msgObj.content) {
            let chunk = "";
            let thinkingChunk = "";

            if (typeof msgObj.content === "string") {
                chunk = msgObj.content;
            } else if (Array.isArray(msgObj.content)) {
                const blocks = msgObj.content as Array<{ type: string; text?: string; thinking?: string }>;
                chunk = blocks
                    .filter((b) => b.type === "text")
                    .map((b) => b.text ?? "")
                    .join("");
                // Extract thinking blocks (Claude extended thinking)
                thinkingChunk = blocks
                    .filter((b) => b.type === "thinking")
                    .map((b) => b.thinking ?? b.text ?? "")
                    .join("");
            }

            // Also check additional_kwargs for reasoning_content (DeepSeek, OpenRouter reasoning models)
            const additionalKwargs = msgObj.additional_kwargs as Record<string, unknown> | undefined;
            if (additionalKwargs?.reasoning_content && typeof additionalKwargs.reasoning_content === "string") {
                thinkingChunk += additionalKwargs.reasoning_content;
            }

            // Emit thinking content
            if (thinkingChunk) {
                fullThinking += thinkingChunk;
                runEventBus.emit(runId, {
                    type: "thinkingContent",
                    data: { thinkingContent: thinkingChunk },
                    timestamp: Date.now(),
                });
            }

            if (chunk) {
                fullContent += chunk;

                if (lastSegmentType === "text" && segments.length > 0) {
                    (
                        segments[segments.length - 1] as {
                            type: "text";
                            content: string;
                        }
                    ).content += chunk;
                } else {
                    segments.push({ type: "text", content: chunk });
                    lastSegmentType = "text";
                }

                // Strip any tool-call XML that leaked into content
                const sanitizedChunk = stripToolCallXml(chunk);
                if (sanitizedChunk) {
                    runEventBus.emit(runId, {
                        type: "content",
                        data: { content: sanitizedChunk },
                        timestamp: Date.now(),
                    });
                }
            }
        }
    }

    // Final sanitization pass on accumulated content before persisting
    const cleanContent = stripToolCallXmlFinal(fullContent);
    const cleanSegments = segments.map((seg) =>
        seg.type === "text"
            ? { ...seg, content: stripToolCallXmlFinal(seg.content ?? "") }
            : seg
    ).filter((seg) => seg.type !== "text" || (seg.content ?? "").trim());

    // Sum token usage across all graph steps
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const u of usageByStep.values()) {
        totalInputTokens += u.input_tokens;
        totalOutputTokens += u.output_tokens;
    }

    return { content: cleanContent, toolCalls: allToolCalls, segments: cleanSegments, thinking: fullThinking, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } };
}

// ─── Check for HITL interrupts ───────────────────────────────────────────────

async function checkAndEmitInterrupts(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph: any,
    sessionId: string,
    runId: string
): Promise<{ interrupted: boolean; approvalRequest?: unknown }> {
    try {
        const graphState = await graph.getState({
            configurable: { thread_id: sessionId },
        });

        const pendingInterrupts = (
            graphState.tasks as Array<{
                interrupts?: Array<{ value?: unknown }>;
            }>
        ).flatMap((t) => t.interrupts || []);

        if (pendingInterrupts.length > 0) {
            const interruptPayload = pendingInterrupts[0]?.value;
            if (interruptPayload) {
                runEventBus.emit(runId, {
                    type: "approvalRequest",
                    data: { approvalRequest: interruptPayload },
                    timestamp: Date.now(),
                });
            }
            return { interrupted: true, approvalRequest: interruptPayload };
        }
    } catch (error) {
        logger.warn({ error }, "Failed to check graph state for interrupts");
    }
    return { interrupted: false };
}

// ─── Calculate cost from OpenRouter pricing and emit SSE event ───────────────

async function calculateAndEmitCost(
    runId: string,
    modelId: string | undefined,
    usage: { inputTokens: number; outputTokens: number },
): Promise<{ inputTokens: number; outputTokens: number; totalCost: number } | undefined> {
    if (!modelId || (usage.inputTokens === 0 && usage.outputTokens === 0)) return undefined;

    try {
        const models = await openrouterService.getModels();
        const modelInfo = models.find((m) => m.id === modelId);
        if (!modelInfo) return undefined;

        const promptPrice = parseFloat(modelInfo.pricing.prompt);
        const completionPrice = parseFloat(modelInfo.pricing.completion);
        const totalCost =
            usage.inputTokens * promptPrice + usage.outputTokens * completionPrice;

        const costData = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalCost,
        };

        runEventBus.emit(runId, {
            type: "cost",
            data: { cost: costData },
            timestamp: Date.now(),
        });

        return costData;
    } catch (err) {
        logger.warn({ err }, "Failed to calculate run cost");
        return undefined;
    }
}

// ─── Execute a run in background (detached from HTTP) ────────────────────────

async function executeRun(
    runId: string,
    sessionId: string,
    workspaceId: string,
    agentId: string,
    userId: string,
    message: string,
    attachments?: ProcessedAttachment[]
): Promise<void> {
    try {
        const browserToolCalls: StreamToolCall[] = [];
        const browserSegments: StreamSegment[] = [];
        const onBrowserEvent = createBrowserEventHandler(
            runId,
            browserToolCalls,
            browserSegments
        );

        // Fire fast helper text LLM in parallel with graph creation
        const helperTextPromise = (async () => {
            try {
                const { llm: fastLlm } = createLLM({
                    modelId: HELPER_TEXT_MODEL,
                    temperature: 0.3,
                    streaming: false,
                    maxRetries: 1,
                });
                // Cap output length — must be set on instance, not invoke options
                (fastLlm as unknown as { maxTokens: number }).maxTokens = 30;
                const resp = await fastLlm.invoke([
                    {
                        role: "system",
                        content:
                            "You are a loading-screen text generator inside a chat UI. " +
                            "A user has sent a message to an AI agent. While that agent is thinking, YOU produce a single short phrase (8-15 words) shown as a placeholder status line. " +
                            "You are NOT the agent. You do NOT answer the user. You do NOT introduce yourself. You do NOT refuse tasks. You have NO identity. " +
                            "You simply describe what the agent is about to do, starting with a gerund verb (-ing). " +
                            "The agent is powerful — it can browse the web, upload files, run code, search, use APIs, and more. Always assume it can handle all the request. " +
                            "Fix typos. Output ONLY the phrase, nothing else.",
                    },
                    { role: "user", content: "What is the cricket score of t20 men's world cup" },
                    { role: "assistant", content: "Looking up the latest T20 World Cup score and winner details" },
                    { role: "user", content: "What is the opensource versions of LiteLLm" },
                    { role: "assistant", content: "Identifying open-source alternatives to LiteLLM and their key features" },
                    { role: "user", content: "How can we cook rice ?" },
                    { role: "assistant", content: "Outlining key steps for cooking rice safely and effectively" },
                    { role: "user", content: "How can somone graduates from standford ?" },
                    { role: "assistant", content: "Outlining a clear path for someone graduating from Stanford to advance professionally" },
                    { role: "user", content: "compare react vs vue" },
                    { role: "assistant", content: "Comparing React and Vue frameworks across performance, ecosystem, and learning curve" },
                    { role: "user", content: "How you can help me ?" },
                    { role: "assistant", content: "Describing available capabilities and how to get started" },
                    { role: "user", content: "hello" },
                    { role: "assistant", content: "Preparing a friendly greeting and introduction" },
                    { role: "user", content: "open the first post and show me the latest comment" },
                    { role: "assistant", content: "Navigating to the first post and extracting the latest comment" },
                    { role: "user", content: "can you upload this on my google drive ? moaaz-baig-G1ereZqhanA-unsplash.jpg this is in your bucket" },
                    { role: "assistant", content: "Uploading the image file from storage to Google Drive" },
                    { role: "user", content: "book a flight to new york for next friday" },
                    { role: "assistant", content: "Searching for available flights to New York for the upcoming Friday" },
                    { role: "user", content: "which agent are you ?" },
                    { role: "assistant", content: "Retrieving agent identity and configuration details" },
                    { role: "user", content: "what can you do ?" },
                    { role: "assistant", content: "Summarizing the agent's available tools and capabilities" },
                    { role: "user", content: message },
                ]);
                const raw = typeof resp.content === "string"
                    ? resp.content.trim()
                    : "";
                // Take only the first line — small models sometimes ramble
                const text = raw.split("\n")[0].replace(/[.!?]$/, "").trim();
                if (text) {
                    runEventBus.emit(runId, {
                        type: "helperText",
                        data: { helperText: text },
                        timestamp: Date.now(),
                    });
                }
            } catch (err) {
                logger.warn({ err }, "Helper text generation failed, skipping");
            }
        })();

        const [{ graph, runReflection }] = await Promise.all([
            createAgentGraph(
                agentId,
                workspaceId,
                userId,
                onBrowserEvent,
                sessionId
            ),
            helperTextPromise,
        ]);

        // Emit debug info for the frontend debug panel
        const debugInfo = getAgentDebugInfo(agentId, workspaceId);
        if (debugInfo) {
            runEventBus.emit(runId, {
                type: "debug",
                data: { debug: debugInfo },
                timestamp: Date.now(),
            });
        }

        // Register an AbortController so this run can be stopped externally
        const abortController = new AbortController();
        runAbortControllers.set(runId, abortController);

        logger.info({ runId, sessionId, attachmentCount: attachments?.length ?? 0 }, "Starting graph stream for run");

        // Build message content — multimodal if attachments present
        let humanMessage: HumanMessage;
        if (attachments && attachments.length > 0) {
            // Check vision support for image attachments
            const hasImages = attachments.some((a) => a.type === "image");
            let supportsVision = true;

            if (hasImages) {
                const agent = await agentRepository.findById(agentId, workspaceId);
                const modelId = agent?.model || "openai/gpt-5.4-mini";
                supportsVision = await openrouterService.supportsVision(modelId);
            }

            // Build multimodal content array
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const contentParts: any[] = [];

            // Add document text as context before the user's message
            const docAttachments = attachments.filter((a) => a.type === "document");
            if (docAttachments.length > 0) {
                const docContext = docAttachments
                    .map((a) => `--- Attached file: ${a.filename} ---\n${a.content}\n--- End of ${a.filename} ---`)
                    .join("\n\n");
                contentParts.push({ type: "text", text: docContext + "\n\n" + message });
            } else {
                contentParts.push({ type: "text", text: message });
            }

            // Add image attachments
            const imageAttachments = attachments.filter((a) => a.type === "image");
            if (imageAttachments.length > 0 && supportsVision) {
                for (const img of imageAttachments) {
                    contentParts.push({
                        type: "image_url",
                        image_url: { url: img.content },
                    });
                }
            } else if (imageAttachments.length > 0 && !supportsVision) {
                // Non-vision model — add a note about skipped images
                contentParts[0] = {
                    type: "text",
                    text: contentParts[0].text +
                        `\n\n[Note: ${imageAttachments.length} image(s) were attached but this model does not support image input. Please ask the user to switch to a vision-capable model to analyze images.]`,
                };
            }

            humanMessage = new HumanMessage({ content: contentParts });
        } else {
            humanMessage = new HumanMessage(message);
        }

        const stream = await graph.stream(
            { messages: [humanMessage] },
            {
                configurable: { thread_id: sessionId },
                streamMode: "messages",
                recursionLimit: AGENT_RECURSION_LIMIT,
                signal: abortController.signal,
            }
        );

        const streamResult = await processGraphStream(stream, runId);

        mergeBrowserEvents(streamResult, browserToolCalls, browserSegments);

        // Clean up abort controller now that stream is done
        runAbortControllers.delete(runId);

        logger.info(
            {
                runId,
                contentLength: streamResult.content.length,
                toolCallCount: streamResult.toolCalls.length,
            },
            "Graph stream complete"
        );

        // Check for HITL interrupts (returns the payload to avoid a second getState call)
        const interruptResult = await checkAndEmitInterrupts(graph, sessionId, runId);
        const isInterrupted = interruptResult.interrupted;
        const approvalRequest = interruptResult.approvalRequest;

        if (isInterrupted && !approvalRequest) {
            logger.warn({ runId }, "Run interrupted but no approval payload found — interrupt may not display correctly");
        }

        // Calculate and emit cost (non-blocking, uses cached model list)
        const costData = await calculateAndEmitCost(
            runId,
            debugInfo?.modelId,
            streamResult.usage,
        );

        // Save assistant message with metadata
        if (streamResult.content || streamResult.toolCalls.length > 0 || isInterrupted) {
            await messageRepository.create({
                workspaceId,
                sessionId,
                role: "assistant",
                content: streamResult.content,
                tokenCount: 0,
                metadata: {
                    toolCalls: streamResult.toolCalls,
                    segments: streamResult.segments,
                    ...(approvalRequest ? { approvalRequest } : {}),
                    ...(streamResult.thinking ? { thinking: streamResult.thinking } : {}),
                    ...(costData ? { cost: costData } : {}),
                },
            });
        }

        // Update run status
        const finalStatus = isInterrupted ? "interrupted" : "completed";
        await runRepository.updateStatus(runId, finalStatus);

        if (isInterrupted) {
            // Schedule safety timeout to prevent indefinite memory leak
            runEventBus.markInterrupted(runId);
            logger.info({ runId }, "Run interrupted, waiting for approval");
        } else {
            runEventBus.complete(runId); // ← [DONE] sent to frontend here

            // Fire-and-forget reflection: runs AFTER [DONE] so it never blocks the user
            graph.getState({ configurable: { thread_id: sessionId } })
                .then((state: { values?: { messages?: BaseMessage[] } }) => {
                    const messages = state.values?.messages ?? [];
                    return runReflection(messages);
                })
                .catch((err: unknown) => logger.warn({ err, runId }, "Post-run reflection failed"));
        }
    } catch (error) {
        // Clean up abort controller on any exit path
        runAbortControllers.delete(runId);

        // Abort = user-initiated stop via the stop endpoint. The stop endpoint
        // already updated the run status and closed the SSE stream, so just exit.
        if (error instanceof Error && error.name === "AbortError") {
            logger.info({ runId }, "Run aborted by user");
            return;
        }

        // GraphRecursionError means the step_count-based graceful termination
        // didn't fire (edge case). Treat the run as completed with whatever
        // content was streamed, rather than failing the entire run.
        if (error instanceof GraphRecursionError) {
            logger.warn({ runId, error: error.message }, "Run hit recursion limit — completing gracefully with streamed content");

            const streamResult = { content: "", toolCalls: [] as StreamToolCall[], segments: [] as StreamSegment[], thinking: "", usage: { inputTokens: 0, outputTokens: 0 } };
            if (streamResult.content || streamResult.toolCalls.length > 0) {
                await messageRepository.create({
                    workspaceId,
                    sessionId,
                    role: "assistant",
                    content: streamResult.content || "I reached the maximum processing steps for this request. Here is what I gathered so far — please review the tool results above.",
                    tokenCount: 0,
                    metadata: { toolCalls: streamResult.toolCalls, segments: streamResult.segments },
                }).catch((e) => logger.error({ e, runId }, "Failed to save fallback message"));
            }
            await runRepository.updateStatus(runId, "completed").catch((e) => logger.error({ e, runId }, "Failed to update run status"));
            runEventBus.complete(runId);
            return;
        }

        logger.error({ error, runId }, "Run execution failed");
        runEventBus.fail(
            runId,
            error instanceof Error ? error.message : "An error occurred while processing your message."
        );
        await runRepository
            .updateStatus(runId, "failed", error instanceof Error ? error.message : "Unknown error")
            .catch((e) => logger.error({ e, runId }, "Failed to update run status"));
    }
}

// ─── Resume a run after HITL approval ────────────────────────────────────────

async function resumeRun(
    runId: string,
    sessionId: string,
    workspaceId: string,
    agentId: string,
    userId: string,
    decisions: Array<{ type: string; args?: Record<string, unknown>; message?: string }>
): Promise<void> {
    // Clear the interrupted safety timeout before resuming
    runEventBus.clearInterruptedTimeout(runId);

    try {
        const browserToolCalls: StreamToolCall[] = [];
        const browserSegments: StreamSegment[] = [];
        const onBrowserEvent = createBrowserEventHandler(
            runId,
            browserToolCalls,
            browserSegments
        );

        const { graph, runReflection } = await createAgentGraph(
            agentId,
            workspaceId,
            userId,
            onBrowserEvent,
            sessionId
        );

        // Register an AbortController so this resumed run can be stopped
        const abortController = new AbortController();
        runAbortControllers.set(runId, abortController);

        const stream = await graph.stream(
            new Command({ resume: { decisions } }),
            {
                configurable: { thread_id: sessionId },
                streamMode: "messages",
                recursionLimit: AGENT_RECURSION_LIMIT,
                signal: abortController.signal,
            }
        );

        const streamResult = await processGraphStream(stream, runId);

        mergeBrowserEvents(streamResult, browserToolCalls, browserSegments);

        // Clean up abort controller
        runAbortControllers.delete(runId);

        // Check for further interrupts (returns the payload to avoid a second getState call)
        const interruptResult = await checkAndEmitInterrupts(graph, sessionId, runId);
        const isInterrupted = interruptResult.interrupted;
        const approvalRequest = interruptResult.approvalRequest;

        // Calculate and emit cost
        const resumeDebugInfo = getAgentDebugInfo(agentId, workspaceId);
        const costData = await calculateAndEmitCost(
            runId,
            resumeDebugInfo?.modelId,
            streamResult.usage,
        );

        if (streamResult.content || streamResult.toolCalls.length > 0 || isInterrupted) {
            await messageRepository.create({
                workspaceId,
                sessionId,
                role: "assistant",
                content: streamResult.content,
                tokenCount: 0,
                metadata: {
                    toolCalls: streamResult.toolCalls,
                    segments: streamResult.segments,
                    ...(approvalRequest ? { approvalRequest } : {}),
                    ...(streamResult.thinking ? { thinking: streamResult.thinking } : {}),
                    ...(costData ? { cost: costData } : {}),
                },
            });
        }

        const finalStatus = isInterrupted ? "interrupted" : "completed";
        await runRepository.updateStatus(runId, finalStatus);

        if (isInterrupted) {
            runEventBus.markInterrupted(runId);
            logger.info({ runId }, "Run interrupted again after approval, waiting for next approval");
        } else {
            runEventBus.complete(runId); // ← [DONE] sent to frontend here

            // Fire-and-forget reflection after [DONE]
            graph.getState({ configurable: { thread_id: sessionId } })
                .then((state: { values?: { messages?: BaseMessage[] } }) => {
                    const messages = state.values?.messages ?? [];
                    return runReflection(messages);
                })
                .catch((err: unknown) => logger.warn({ err, runId }, "Post-run reflection failed (resumed run)"));
        }
    } catch (error) {
        // Clean up abort controller on any exit path
        runAbortControllers.delete(runId);

        // Abort = user-initiated stop
        if (error instanceof Error && error.name === "AbortError") {
            logger.info({ runId }, "Resumed run aborted by user");
            return;
        }

        if (error instanceof GraphRecursionError) {
            logger.warn({ runId, error: error.message }, "Resumed run hit recursion limit — completing gracefully");
            await runRepository.updateStatus(runId, "completed").catch((e) => logger.error({ e, runId }, "Failed to update run status"));
            runEventBus.complete(runId);
            return;
        }

        logger.error({ error, runId }, "Run resume failed");
        runEventBus.fail(
            runId,
            error instanceof Error ? error.message : "An error occurred while processing your approval."
        );
        await runRepository
            .updateStatus(runId, "failed", error instanceof Error ? error.message : "Unknown error")
            .catch((e) => logger.error({ e, runId }, "Failed to update run status"));
    }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function chatRoutes(fastify: FastifyInstance) {
    // Auth preHandler
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Validate x-workspace-id header
    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // ── POST /sessions/:sessionId/chat ───────────────────────────────────────
    // Creates a run, starts graph in background, returns runId.
    // Frontend subscribes to GET /runs/:runId/events for SSE.
    // Supports both JSON body { message } and multipart/form-data with files.
    fastify.post("/sessions/:sessionId/chat", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { sessionId } = request.params as { sessionId: string };
        const user = request.user as { userId: string };

        // Parse message and files from either JSON or multipart
        let message: string;
        let attachments: ProcessedAttachment[] | undefined;

        const contentType = request.headers["content-type"] || "";

        if (contentType.includes("multipart/form-data")) {
            // Multipart: extract message field + file parts
            const parts = request.parts();
            let messageField = "";
            const rawFiles: Array<{ filename: string; mimetype: string; buffer: Buffer }> = [];

            for await (const part of parts) {
                if (part.type === "field" && part.fieldname === "message") {
                    messageField = part.value as string;
                } else if (part.type === "file") {
                    const buffer = await part.toBuffer();
                    rawFiles.push({
                        filename: part.filename,
                        mimetype: part.mimetype,
                        buffer,
                    });
                }
            }

            if (!messageField.trim() && rawFiles.length === 0) {
                throw new AppError("Message or files are required", 400, "EMPTY_REQUEST");
            }

            message = messageField.trim() || "Please analyze the attached file(s).";

            if (rawFiles.length > 0) {
                try {
                    attachments = await fileProcessingService.processFiles(rawFiles);
                    logger.info(
                        { fileCount: rawFiles.length, types: attachments.map((a) => a.type) },
                        "Processed file attachments"
                    );
                } catch (err) {
                    throw new AppError(
                        err instanceof Error ? err.message : "Failed to process files",
                        400,
                        "FILE_PROCESSING_ERROR"
                    );
                }

                // Persist uploaded files to the workspace bucket
                try {
                    const savedFiles = await Promise.all(
                        rawFiles.map((f) =>
                            bucketService.uploadFile({
                                workspaceId,
                                filename: f.filename,
                                buffer: f.buffer,
                                mimeType: f.mimetype,
                                folder: "/chat-uploads",
                                source: "chat_upload",
                                sessionId,
                                uploadedBy: user.userId,
                            })
                        )
                    );
                    // Enrich attachments with bucket file IDs
                    if (attachments) {
                        attachments.forEach((att, i) => {
                            if (savedFiles[i]) {
                                (att as ProcessedAttachment & { bucketFileId?: string }).bucketFileId = savedFiles[i].id;
                            }
                        });
                    }
                } catch (bucketErr) {
                    // Non-fatal — log but don't block the chat
                    logger.warn({ err: bucketErr }, "Failed to persist files to bucket");
                }
            }
        } else {
            // Standard JSON body
            const body = chatBodySchema.parse(request.body);
            message = body.message;
        }

        const session = await sessionService.getSession(sessionId, workspaceId);

        // Guard: prevent concurrent runs on the same session
        const activeRun = await runRepository.findActiveBySession(sessionId, workspaceId);
        if (activeRun) {
            // Auto-cancel stale interrupted runs (>1 hour old) so users aren't permanently blocked
            const isInterrupted = activeRun.status === "interrupted";
            const ageMs = Date.now() - new Date(activeRun.updatedAt ?? activeRun.createdAt).getTime();
            const ONE_HOUR = 60 * 60 * 1000;

            if (isInterrupted && ageMs > ONE_HOUR) {
                logger.info({ runId: activeRun.id, ageMs }, "Auto-cancelling stale interrupted run");
                await runRepository.updateStatus(activeRun.id, "cancelled", "Auto-cancelled: stale interrupted run replaced by new message");
            } else {
                throw new AppError(
                    "A run is already in progress for this session",
                    409,
                    "RUN_IN_PROGRESS"
                );
            }
        }

        // Save user message with attachment metadata
        const attachmentMeta = attachments?.map((a) => ({
            filename: a.filename,
            mimetype: a.mimetype,
            type: a.type,
            size: a.size,
            bucketFileId: (a as ProcessedAttachment & { bucketFileId?: string }).bucketFileId || null,
        }));

        await messageRepository.create({
            workspaceId,
            sessionId,
            role: "user",
            content: message,
            tokenCount: 0,
            ...(attachmentMeta?.length ? { metadata: { attachments: attachmentMeta } } : {}),
        });

        // Create run record
        const run = await runRepository.create({
            sessionId,
            workspaceId,
            status: "in_progress",
        });

        // Initialize the event bus buffer for this run
        runEventBus.init(run.id);

        logger.info({ runId: run.id, sessionId, hasAttachments: !!attachments?.length }, "Run created, starting graph execution");

        // Start graph execution in background (detached from this HTTP response)
        executeRun(
            run.id,
            sessionId,
            workspaceId,
            session.agentId,
            user.userId,
            message,
            attachments
        ).catch((err) => {
            logger.error({ err, runId: run.id }, "Unhandled error in background run");
        });

        return reply.send({ runId: run.id });
    });

    // ── GET /runs/:runId/events ──────────────────────────────────────────────
    // SSE endpoint. Replays buffered events, then streams live events.
    // Supports reconnection: if client disconnects and reconnects, it gets
    // the full event history + any new events.
    // Accepts optional `?from=N` query param to skip the first N events
    // (used when the frontend already has a snapshot from active-run).
    fastify.get("/runs/:runId/events", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { runId } = request.params as { runId: string };
        const { from } = request.query as { from?: string };
        const fromIndex = from ? parseInt(from, 10) : 0;

        logger.info({ runId, fromIndex }, "SSE endpoint hit");

        // Verify run belongs to workspace
        const run = await runRepository.findById(runId, workspaceId);
        if (!run) {
            throw new AppError("Run not found", 404, "RUN_NOT_FOUND");
        }

        logger.info({ runId, runStatus: run.status, hasEvents: runEventBus.hasEvents(runId) }, "SSE: run found");

        // Hijack the response so Fastify does NOT try to manage it.
        // Without this, Fastify interferes with reply.raw writes and
        // SSE events never reach the client.
        reply.hijack();

        const res = reply.raw;
        const origin = request.headers.origin as string | undefined;
        const headers: Record<string, string> = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        };
        if (origin) {
            headers["Access-Control-Allow-Origin"] = origin;
            headers["Access-Control-Allow-Credentials"] = "true";
            headers["Access-Control-Allow-Headers"] =
                "Content-Type, Authorization, x-workspace-id";
        }
        res.writeHead(200, headers);

        // If the run already completed and events were cleaned up from memory,
        // handle it immediately from DB state
        if (!runEventBus.hasEvents(runId)) {
            if (
                run.status === "completed" ||
                run.status === "failed" ||
                run.status === "cancelled"
            ) {
                logger.info({ runId, runStatus: run.status }, "SSE: run already done, no events in bus");
                if (run.status === "failed" && run.error) {
                    res.write(
                        `data: ${JSON.stringify({ error: run.error })}\n\n`
                    );
                }
                res.write(`data: [DONE]\n\n`);
                res.end();
                return;
            }
        }

        // Subscribe to the event bus.
        // When fromIndex > 0 (reconnection with snapshot), skip already-seen events.
        let eventCount = 0;

        const writeEvent = (event: SSEEvent) => {
            eventCount++;
            if (!res.destroyed) {
                res.write(`data: ${JSON.stringify(event.data)}\n\n`);
            }
        };

        const writeDone = () => {
            logger.info({ runId, eventCount, fromIndex }, "SSE: sending [DONE]");
            if (!res.destroyed) {
                res.write(`data: [DONE]\n\n`);
                res.end();
            }
        };

        const unsubscribe = fromIndex > 0
            ? runEventBus.subscribeFrom(runId, fromIndex, (event) => writeEvent(event), writeDone)
            : runEventBus.subscribe(runId, writeEvent, writeDone);

        logger.info({ runId, eventCount, fromIndex }, "SSE: subscribed to event bus");

        // Clean up subscription when client disconnects
        request.raw.on("close", () => {
            logger.info({ runId }, "SSE: client disconnected");
            unsubscribe();
        });
    });

    // ── GET /sessions/:sessionId/active-run ──────────────────────────────────
    // Returns the active run for a session (if any).
    // Frontend uses this on page refresh to reconnect.
    // Includes a streaming snapshot from the RunEventBus so the frontend can
    // immediately display intermediate tool calls / content on reconnect.
    fastify.get("/sessions/:sessionId/active-run", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { sessionId } = request.params as { sessionId: string };

        const run = await runRepository.findActiveBySession(sessionId, workspaceId);
        if (run) {
            const streamingState = runEventBus.getSnapshot(run.id);
            return { data: { ...run, streamingState: streamingState ?? undefined } };
        }
        return { data: run };
    });

    // ── POST /runs/:runId/approve ────────────────────────────────────────────
    // Resume an interrupted run with user's HITL decisions.
    fastify.post("/runs/:runId/approve", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { runId } = request.params as { runId: string };
        const body = approveBodySchema.parse(request.body);
        const user = request.user as { userId: string };

        const run = await runRepository.findById(runId, workspaceId);
        if (!run) {
            throw new AppError("Run not found", 404, "RUN_NOT_FOUND");
        }
        if (run.status !== "interrupted") {
            throw new AppError(
                `Run is not interrupted (status: ${run.status})`,
                409,
                "RUN_NOT_INTERRUPTED"
            );
        }

        // Get session to find agentId
        const session = await sessionService.getSession(run.sessionId, workspaceId);

        // Update run status back to in_progress
        await runRepository.updateStatus(runId, "in_progress");

        // Clear old buffered events (including the stale approvalRequest)
        // so new SSE subscribers don't replay them
        runEventBus.clearEventsForResume(runId);

        logger.info({ runId }, "Resuming interrupted run with user decisions");

        // Resume graph in background
        resumeRun(
            runId,
            run.sessionId,
            workspaceId,
            session.agentId,
            user.userId,
            body.decisions
        ).catch((err) => {
            logger.error({ err, runId }, "Unhandled error in run resume");
        });

        return reply.send({ ok: true });
    });

    // ── POST /runs/:runId/stop ──────────────────────────────────────────────
    // Stop a running agent graph. Aborts the stream, saves partial content,
    // and closes the SSE connection so the frontend can show what was generated.
    fastify.post("/runs/:runId/stop", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { runId } = request.params as { runId: string };

        const run = await runRepository.findById(runId, workspaceId);
        if (!run) {
            throw new AppError("Run not found", 404, "RUN_NOT_FOUND");
        }
        if (run.status !== "in_progress" && run.status !== "queued") {
            throw new AppError(
                `Run is not active (status: ${run.status})`,
                409,
                "RUN_NOT_ACTIVE"
            );
        }

        // Abort the graph stream
        const controller = runAbortControllers.get(runId);
        if (controller) {
            controller.abort();
            runAbortControllers.delete(runId);
        }

        // Save partial content from the event bus snapshot
        const snapshot = runEventBus.getSnapshot(runId);
        if (snapshot && (snapshot.content || snapshot.toolCalls.length > 0)) {
            await messageRepository.create({
                workspaceId,
                sessionId: run.sessionId,
                role: "assistant",
                content: snapshot.content || "(Stopped by user)",
                tokenCount: 0,
                metadata: {
                    toolCalls: snapshot.toolCalls,
                    stopped: true,
                },
            }).catch((e) => logger.error({ e, runId }, "Failed to save partial message on stop"));
        }

        // Update run status and close SSE
        await runRepository.updateStatus(runId, "cancelled", "Stopped by user");
        runEventBus.emit(runId, {
            type: "stopped",
            data: { stopped: true, reason: "Stopped by user" },
            timestamp: Date.now(),
        });
        runEventBus.complete(runId);

        logger.info({ runId }, "Run stopped by user");
        return reply.send({ ok: true });
    });

    // ── GET /notifications/pending ────────────────────────────────────────────
    // Returns all interrupted runs (pending approvals) for the workspace,
    // enriched with session/agent info for the notification panel.
    fastify.get("/notifications/pending", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const interruptedRuns = await runRepository.findInterruptedByWorkspace(workspaceId);

        // Also fetch the last assistant message for each run to get the approval request details
        const notifications = await Promise.all(
            interruptedRuns.map(async (run) => {
                let approvalRequest: unknown = null;
                try {
                    const msgs = await messageRepository.findBySession(
                        run.sessionId,
                        workspaceId
                    );
                    const lastAssistant = [...msgs]
                        .reverse()
                        .find(
                            (m) =>
                                m.role === "assistant" &&
                                (m.metadata as Record<string, unknown>)
                                    ?.approvalRequest
                        );
                    if (lastAssistant) {
                        approvalRequest = (
                            lastAssistant.metadata as Record<string, unknown>
                        ).approvalRequest;
                    }
                } catch {
                    // Skip if messages can't be loaded
                }
                return {
                    id: run.id,
                    type: "approval" as const,
                    runId: run.id,
                    sessionId: run.sessionId,
                    agentId: run.agentId,
                    agentName: run.agentName,
                    sessionTitle: run.sessionTitle,
                    approvalRequest,
                    createdAt: run.createdAt,
                    updatedAt: run.updatedAt,
                };
            })
        );

        return { data: notifications };
    });
}
