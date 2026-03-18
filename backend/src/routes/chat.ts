import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { sessionService } from "../services/session.service.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

const chatBodySchema = z.object({
    message: z.string().min(1, "Message is required"),
});

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

        // 1. Verify session belongs to workspace
        const session = await sessionService.getSession(
            sessionId,
            workspaceId
        );

        // 2. Save user message to DB
        await messageRepository.create({
            workspaceId,
            sessionId,
            role: "user",
            content: body.message,
            tokenCount: 0,
        });

        // 3. Set SSE headers (include CORS - required when using reply.raw directly)
        const origin = request.headers.origin || "*";
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin,
        });

        try {
            // 4. Create LangGraph and stream
            const graph = await createAgentGraph(
                session.agentId,
                workspaceId
            );

            let fullContent = "";

            const stream = await graph.stream(
                { messages: [new HumanMessage(body.message)] },
                {
                    configurable: { thread_id: sessionId },
                    streamMode: "messages",
                }
            );

            for await (const [message] of stream) {
                if (!message) continue;

                // Detect AI tool_calls → emit toolCall event for each
                if (
                    message instanceof AIMessage &&
                    message.tool_calls &&
                    message.tool_calls.length > 0
                ) {
                    for (const tc of message.tool_calls) {
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

                        reply.raw.write(
                            `data: ${JSON.stringify({
                                toolCall: {
                                    id: tc.id,
                                    name: displayName,
                                    args: argsPreview,
                                    type: isAgent ? "agent" : "tool",
                                    status: "running",
                                },
                            })}\n\n`
                        );
                    }
                    continue; // Don't stream the AI message that contains tool_calls
                }

                // Detect tool responses → emit toolResult event
                if (message instanceof ToolMessage) {
                    const isAgent = message.name?.startsWith("agent_");
                    const displayName = isAgent
                        ? `Delegated to ${(message.name || "").replace(/^agent_/, "").replace(/_/g, " ")}`
                        : message.name || "tool";
                    const resultText = typeof message.content === "string"
                        ? message.content.slice(0, 300)
                        : "";

                    reply.raw.write(
                        `data: ${JSON.stringify({
                            toolCall: {
                                id: message.tool_call_id,
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
                if (
                    "content" in message &&
                    typeof message.content === "string" &&
                    message.content
                ) {
                    const chunk = message.content;
                    fullContent += chunk;
                    reply.raw.write(
                        `data: ${JSON.stringify({ content: chunk })}\n\n`
                    );
                }
            }

            // 5. Save assistant message with full content
            await messageRepository.create({
                workspaceId,
                sessionId,
                role: "assistant",
                content: fullContent,
                tokenCount: 0,
            });

            // 6. Signal done
            reply.raw.write(`data: [DONE]\n\n`);
        } catch (error: any) {
            logger.error({ error, sessionId, workspaceId }, "Chat processing failed");
            const errorMessage = error?.message || "An error occurred while processing your message.";
            reply.raw.write(
                `data: ${JSON.stringify({
                    error: `[BACKEND ERROR] ${errorMessage}`,
                })}\n\n`
            );
            reply.raw.write(`data: [DONE]\n\n`);
        }

        reply.raw.end();
    });
}
