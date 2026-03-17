import { HumanMessage } from "@langchain/core/messages";
import { sessionRepository } from "../repositories/session.repository.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { channelRepository } from "../repositories/channel.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { logger } from "../lib/logger.ts";
import type { NormalizedMessage, NormalizedResponse } from "./types.ts";

// Will be set by channel-manager
let sendResponseFn: ((connectionId: string, response: NormalizedResponse) => Promise<void>) | null = null;

export function setResponseSender(
    fn: (connectionId: string, response: NormalizedResponse) => Promise<void>
) {
    sendResponseFn = fn;
}

async function findOrCreateSession(
    workspaceId: string,
    agentId: string,
    channelType: string,
    externalUserId: string
): Promise<string> {
    const sessionTitle = `${channelType}:${externalUserId}`;

    // Look for existing session with this title for this agent
    const sessions = await sessionRepository.findByAgent(agentId, workspaceId);
    const existing = sessions.find((s) => s.title === sessionTitle);
    if (existing) return existing.id;

    // Create new session
    const session = await sessionRepository.create({
        workspaceId,
        agentId,
        title: sessionTitle,
    });
    return session.id;
}

export async function routeMessage(message: NormalizedMessage): Promise<void> {
    try {
        // Find or create session for this user+agent pair
        const sessionId = await findOrCreateSession(
            message.workspaceId,
            message.agentId,
            message.channelType,
            message.externalUserId
        );

        // Save user message
        await messageRepository.create({
            workspaceId: message.workspaceId,
            sessionId,
            role: "user",
            content: message.text,
            tokenCount: 0,
        });

        // Create agent graph and invoke (non-streaming for channels)
        const graph = await createAgentGraph(message.agentId, message.workspaceId);

        const result = await graph.invoke(
            { messages: [new HumanMessage(message.text)] },
            { configurable: { thread_id: sessionId } }
        );

        // Extract last AI message content
        const msgs = result.messages;
        const lastMsg = msgs[msgs.length - 1];
        let fullContent = "";
        if (lastMsg && typeof lastMsg.content === "string") {
            fullContent = lastMsg.content;
        } else if (lastMsg && Array.isArray(lastMsg.content)) {
            fullContent = lastMsg.content
                .filter((c: unknown) => typeof c === "object" && c !== null && "text" in (c as Record<string, unknown>))
                .map((c: unknown) => (c as { text: string }).text)
                .join("");
        }

        if (!fullContent) {
            fullContent = "I processed your request but have nothing to say.";
        }

        // Save assistant message
        await messageRepository.create({
            workspaceId: message.workspaceId,
            sessionId,
            role: "assistant",
            content: fullContent,
            tokenCount: 0,
        });

        // Update last message timestamp
        await channelRepository.updateLastMessageAt(message.connectionId);

        // Send response back through channel
        if (sendResponseFn) {
            await sendResponseFn(message.connectionId, {
                text: fullContent,
                threadId: message.threadId,
                messageId: message.messageId,
            });
        }
    } catch (error) {
        logger.error(
            { connectionId: message.connectionId, error },
            "Channel message processing failed"
        );

        if (sendResponseFn) {
            await sendResponseFn(message.connectionId, {
                text: "Something went wrong. Please try again.",
                threadId: message.threadId,
                messageId: message.messageId,
            });
        }
    }
}
