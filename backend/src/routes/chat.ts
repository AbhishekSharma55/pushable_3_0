import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
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
                // Only stream AI message content chunks
                if (
                    message &&
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
}
