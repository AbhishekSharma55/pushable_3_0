import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { sessionService } from "../services/session.service.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

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

/** Shared SSE streaming logic for both chat and approve endpoints */
async function streamGraphToSSE(
    stream: AsyncIterable<[unknown, ...unknown[]]>,
    reply: { raw: { write: (data: string) => boolean } }
): Promise<StreamResult> {
    let fullContent = "";
    const allToolCalls: StreamToolCall[] = [];
    const segments: StreamSegment[] = [];
    let lastSegmentType: "text" | "tools" | null = null;

    for await (const [message] of stream) {
        if (!message) continue;

        logger.info(
            {
                type: (message as { constructor?: { name?: string } })?.constructor?.name,
                isAI: message instanceof AIMessage,
                isTool: message instanceof ToolMessage,
                hasToolCalls: !!(message as AIMessage).tool_calls?.length,
                contentPreview: typeof (message as { content?: unknown }).content === "string"
                    ? ((message as { content: string }).content).slice(0, 50)
                    : "non-string",
            },
            "Stream chunk received"
        );

        // Detect AI tool_calls → emit toolCall event for each
        const msgObj = message as Record<string, unknown>;
        const toolCalls = msgObj.tool_calls as Array<{ id?: string; name: string; args?: Record<string, unknown> }> | undefined;
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

                // Track in segments
                if (lastSegmentType === "tools" && segments.length > 0) {
                    (segments[segments.length - 1] as { type: "tools"; toolCalls: StreamToolCall[] }).toolCalls.push(toolCallEvent);
                } else {
                    segments.push({ type: "tools", toolCalls: [toolCallEvent] });
                    lastSegmentType = "tools";
                }

                reply.raw.write(
                    `data: ${JSON.stringify({ toolCall: toolCallEvent })}\n\n`
                );
            }
            continue;
        }

        // Detect tool responses → emit toolResult event
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

            // Update existing tool call
            const existing = allToolCalls.find((t) => t.id === msgObj.tool_call_id);
            if (existing) {
                existing.status = "done";
                existing.result = resultText;
                existing.name = displayName;
            }

            reply.raw.write(
                `data: ${JSON.stringify({
                    toolCall: {
                        id: msgObj.tool_call_id,
                        name: displayName,
                        type: isAgent ? "agent" : "tool",
                        status: "done",
                        result: resultText,
                    },
                })}\n\n`
            );
            continue;
        }

        // Stream AI message content chunks
        if (msgObj.content) {
            let chunk = "";

            if (typeof msgObj.content === "string") {
                chunk = msgObj.content;
            } else if (Array.isArray(msgObj.content)) {
                chunk = (msgObj.content as Array<{ type: string; text: string }>)
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join("");
            }

            if (chunk) {
                fullContent += chunk;

                // Track in segments
                if (lastSegmentType === "text" && segments.length > 0) {
                    (segments[segments.length - 1] as { type: "text"; content: string }).content += chunk;
                } else {
                    segments.push({ type: "text", content: chunk });
                    lastSegmentType = "text";
                }

                reply.raw.write(
                    `data: ${JSON.stringify({ content: chunk })}\n\n`
                );
            }
        }
    }

    return { content: fullContent, toolCalls: allToolCalls, segments };
}

/** Check graph state for HITL interrupts and send SSE events if found */
async function checkAndSendInterrupts(
    graph: Awaited<ReturnType<typeof createAgentGraph>>,
    sessionId: string,
    reply: { raw: { write: (data: string) => boolean } }
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
                reply.raw.write(
                    `data: ${JSON.stringify({
                        approvalRequest: interruptPayload,
                    })}\n\n`
                );
            }
            return true; // Graph is interrupted
        }
    } catch (error) {
        logger.warn({ error }, "Failed to check graph state for interrupts");
    }
    return false;
}

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

    // POST /sessions/:sessionId/chat — streaming SSE
    fastify.post("/sessions/:sessionId/chat", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { sessionId } = request.params as { sessionId: string };
        const body = chatBodySchema.parse(request.body);

        const session = await sessionService.getSession(sessionId, workspaceId);

        await messageRepository.create({
            workspaceId,
            sessionId,
            role: "user",
            content: body.message,
            tokenCount: 0,
        });

        const origin = request.headers.origin || "*";
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin,
        });

        try {
            const user = request.user as { userId: string };
            const graph = await createAgentGraph(
                session.agentId,
                workspaceId,
                user.userId
            );

            logger.info({ sessionId }, "Starting graph stream");

            const stream = await graph.stream(
                { messages: [new HumanMessage(body.message)] },
                {
                    configurable: { thread_id: sessionId },
                    streamMode: "messages",
                }
            );

            logger.info("Graph stream created, iterating...");

            const streamResult = await streamGraphToSSE(stream, reply);

            logger.info(
                { contentLength: streamResult.content.length, toolCallCount: streamResult.toolCalls.length },
                "Stream iteration complete"
            );

            // Check for HITL interrupts
            const isInterrupted = await checkAndSendInterrupts(
                graph,
                sessionId,
                reply
            );

            logger.info({ isInterrupted }, "Interrupt check done");

            // Save assistant message with tool calls and segments as metadata
            if (streamResult.content || streamResult.toolCalls.length > 0) {
                await messageRepository.create({
                    workspaceId,
                    sessionId,
                    role: "assistant",
                    content: streamResult.content,
                    tokenCount: 0,
                    metadata: {
                        toolCalls: streamResult.toolCalls,
                        segments: streamResult.segments,
                    },
                });
            }

            reply.raw.write(`data: [DONE]\n\n`);
        } catch (error) {
            logger.error(error);
            reply.raw.write(
                `data: ${JSON.stringify({
                    error: "An error occurred while processing your message.",
                })}\n\n`
            );
            reply.raw.write(`data: [DONE]\n\n`);
        }

        reply.raw.end();
    });

    // POST /sessions/:sessionId/approve — resume graph after HITL interrupt
    fastify.post("/sessions/:sessionId/approve", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { sessionId } = request.params as { sessionId: string };
        const body = approveBodySchema.parse(request.body);

        const session = await sessionService.getSession(sessionId, workspaceId);

        const origin = request.headers.origin || "*";
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-workspace-id",
        });

        try {
            const user = request.user as { userId: string };
            const graph = await createAgentGraph(
                session.agentId,
                workspaceId,
                user.userId
            );

            // Resume graph from the interrupt with the user's decisions
            const stream = await graph.stream(
                new Command({ resume: { decisions: body.decisions } }),
                {
                    configurable: { thread_id: sessionId },
                    streamMode: "messages",
                }
            );

            const streamResult = await streamGraphToSSE(stream, reply);

            // Check for further interrupts (tool chain may have multiple)
            const isInterrupted = await checkAndSendInterrupts(
                graph,
                sessionId,
                reply
            );

            if (streamResult.content || streamResult.toolCalls.length > 0) {
                await messageRepository.create({
                    workspaceId,
                    sessionId,
                    role: "assistant",
                    content: streamResult.content,
                    tokenCount: 0,
                    metadata: {
                        toolCalls: streamResult.toolCalls,
                        segments: streamResult.segments,
                    },
                });
            }

            reply.raw.write(`data: [DONE]\n\n`);
        } catch (error) {
            logger.error(error);
            reply.raw.write(
                `data: ${JSON.stringify({
                    error: "An error occurred while processing your approval.",
                })}\n\n`
            );
            reply.raw.write(`data: [DONE]\n\n`);
        }

        reply.raw.end();
    });
}
