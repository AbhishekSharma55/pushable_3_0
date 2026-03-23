import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { sessionService } from "../services/session.service.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { runRepository } from "../repositories/run.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { runEventBus, type SSEEvent } from "../lib/run-event-bus.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { stripToolCallXml } from "../lib/sanitize-llm-output.ts";
import type { BrowserAgentEventEmitter } from "../lib/browser-agent-tool.ts";

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
    const allToolCalls: StreamToolCall[] = [];
    const segments: StreamSegment[] = [];
    let lastSegmentType: "text" | "tools" | null = null;

    for await (const [message] of stream) {
        if (!message) continue;

        // Detect AI tool_calls
        const msgObj = message as Record<string, unknown>;
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
                    ? (msgObj.content as string).slice(0, 300)
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
            if (typeof msgObj.content === "string") {
                chunk = msgObj.content;
            } else if (Array.isArray(msgObj.content)) {
                chunk = (
                    msgObj.content as Array<{ type: string; text: string }>
                )
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join("");
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
    const cleanContent = stripToolCallXml(fullContent);
    const cleanSegments = segments.map((seg) =>
        seg.type === "text"
            ? { ...seg, content: stripToolCallXml(seg.content ?? "") }
            : seg
    ).filter((seg) => seg.type !== "text" || (seg.content ?? "").trim());

    return { content: cleanContent, toolCalls: allToolCalls, segments: cleanSegments };
}

// ─── Check for HITL interrupts ───────────────────────────────────────────────

async function checkAndEmitInterrupts(
    graph: Awaited<ReturnType<typeof createAgentGraph>>,
    sessionId: string,
    runId: string
): Promise<boolean> {
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
            return true;
        }
    } catch (error) {
        logger.warn({ error }, "Failed to check graph state for interrupts");
    }
    return false;
}

// ─── Execute a run in background (detached from HTTP) ────────────────────────

async function executeRun(
    runId: string,
    sessionId: string,
    workspaceId: string,
    agentId: string,
    userId: string,
    message: string
): Promise<void> {
    try {
        const browserToolCalls: StreamToolCall[] = [];
        const browserSegments: StreamSegment[] = [];
        const onBrowserEvent = createBrowserEventHandler(
            runId,
            browserToolCalls,
            browserSegments
        );

        const graph = await createAgentGraph(
            agentId,
            workspaceId,
            userId,
            onBrowserEvent,
            sessionId
        );

        logger.info({ runId, sessionId }, "Starting graph stream for run");

        const stream = await graph.stream(
            { messages: [new HumanMessage(message)] },
            {
                configurable: { thread_id: sessionId },
                streamMode: "messages",
            }
        );

        const streamResult = await processGraphStream(stream, runId);

        mergeBrowserEvents(streamResult, browserToolCalls, browserSegments);

        logger.info(
            {
                runId,
                contentLength: streamResult.content.length,
                toolCallCount: streamResult.toolCalls.length,
            },
            "Graph stream complete"
        );

        // Check for HITL interrupts
        const isInterrupted = await checkAndEmitInterrupts(graph, sessionId, runId);

        // Get interrupt payload for persistence (if interrupted)
        let approvalRequest: unknown = undefined;
        if (isInterrupted) {
            try {
                const graphState = await graph.getState({
                    configurable: { thread_id: sessionId },
                });
                const pendingInterrupts = (
                    graphState.tasks as Array<{
                        interrupts?: Array<{ value?: unknown }>;
                    }>
                ).flatMap((t) => t.interrupts || []);
                approvalRequest = pendingInterrupts[0]?.value;
            } catch {
                // Already emitted via checkAndEmitInterrupts
            }
        }

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
            runEventBus.complete(runId);
        }
    } catch (error) {
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

        const graph = await createAgentGraph(
            agentId,
            workspaceId,
            userId,
            onBrowserEvent,
            sessionId
        );

        const stream = await graph.stream(
            new Command({ resume: { decisions } }),
            {
                configurable: { thread_id: sessionId },
                streamMode: "messages",
            }
        );

        const streamResult = await processGraphStream(stream, runId);

        mergeBrowserEvents(streamResult, browserToolCalls, browserSegments);

        // Check for further interrupts
        const isInterrupted = await checkAndEmitInterrupts(graph, sessionId, runId);

        // Get interrupt payload for persistence (if interrupted again)
        let approvalRequest: unknown = undefined;
        if (isInterrupted) {
            try {
                const graphState = await graph.getState({
                    configurable: { thread_id: sessionId },
                });
                const pendingInterrupts = (
                    graphState.tasks as Array<{
                        interrupts?: Array<{ value?: unknown }>;
                    }>
                ).flatMap((t) => t.interrupts || []);
                approvalRequest = pendingInterrupts[0]?.value;
            } catch {
                // Already emitted via checkAndEmitInterrupts
            }
        }

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
                },
            });
        }

        const finalStatus = isInterrupted ? "interrupted" : "completed";
        await runRepository.updateStatus(runId, finalStatus);

        if (isInterrupted) {
            runEventBus.markInterrupted(runId);
            logger.info({ runId }, "Run interrupted again after approval, waiting for next approval");
        } else {
            runEventBus.complete(runId);
        }
    } catch (error) {
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
    fastify.post("/sessions/:sessionId/chat", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { sessionId } = request.params as { sessionId: string };
        const body = chatBodySchema.parse(request.body);
        const user = request.user as { userId: string };

        const session = await sessionService.getSession(sessionId, workspaceId);

        // Guard: prevent concurrent runs on the same session
        const activeRun = await runRepository.findActiveBySession(sessionId, workspaceId);
        if (activeRun) {
            throw new AppError(
                "A run is already in progress for this session",
                409,
                "RUN_IN_PROGRESS"
            );
        }

        // Save user message immediately
        await messageRepository.create({
            workspaceId,
            sessionId,
            role: "user",
            content: body.message,
            tokenCount: 0,
        });

        // Create run record
        const run = await runRepository.create({
            sessionId,
            workspaceId,
            status: "in_progress",
        });

        // Initialize the event bus buffer for this run
        runEventBus.init(run.id);

        logger.info({ runId: run.id, sessionId }, "Run created, starting graph execution");

        // Start graph execution in background (detached from this HTTP response)
        executeRun(
            run.id,
            sessionId,
            workspaceId,
            session.agentId,
            user.userId,
            body.message
        ).catch((err) => {
            logger.error({ err, runId: run.id }, "Unhandled error in background run");
        });

        return reply.send({ runId: run.id });
    });

    // ── GET /runs/:runId/events ──────────────────────────────────────────────
    // SSE endpoint. Replays buffered events, then streams live events.
    // Supports reconnection: if client disconnects and reconnects, it gets
    // the full event history + any new events.
    fastify.get("/runs/:runId/events", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { runId } = request.params as { runId: string };

        logger.info({ runId }, "SSE endpoint hit");

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

        // Subscribe to the event bus (replays buffered + streams live)
        let eventCount = 0;
        const unsubscribe = runEventBus.subscribe(
            runId,
            // onEvent: write SSE event to client
            (event: SSEEvent) => {
                eventCount++;
                if (!res.destroyed) {
                    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
                }
            },
            // onDone: send [DONE] and close
            () => {
                logger.info({ runId, eventCount }, "SSE: sending [DONE]");
                if (!res.destroyed) {
                    res.write(`data: [DONE]\n\n`);
                    res.end();
                }
            }
        );

        logger.info({ runId, eventCount }, "SSE: subscribed to event bus");

        // Clean up subscription when client disconnects
        request.raw.on("close", () => {
            logger.info({ runId }, "SSE: client disconnected");
            unsubscribe();
        });
    });

    // ── GET /sessions/:sessionId/active-run ──────────────────────────────────
    // Returns the active run for a session (if any).
    // Frontend uses this on page refresh to reconnect.
    fastify.get("/sessions/:sessionId/active-run", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { sessionId } = request.params as { sessionId: string };

        const run = await runRepository.findActiveBySession(sessionId, workspaceId);
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
