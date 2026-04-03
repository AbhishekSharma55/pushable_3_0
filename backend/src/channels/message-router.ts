import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { sessionRepository } from "../repositories/session.repository.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { channelRepository } from "../repositories/channel.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { logger } from "../lib/logger.ts";
import type { NormalizedMessage, NormalizedResponse } from "./types.ts";

// Will be set by channel-manager
let sendResponseFn: ((connectionId: string, response: NormalizedResponse) => Promise<void>) | null = null;
let sendApprovalFn: ((connectionId: string, chatId: string, text: string, sessionId: string) => Promise<void>) | null = null;

export function setResponseSender(
    fn: (connectionId: string, response: NormalizedResponse) => Promise<void>
) {
    sendResponseFn = fn;
}

export function setApprovalSender(
    fn: (connectionId: string, chatId: string, text: string, sessionId: string) => Promise<void>
) {
    sendApprovalFn = fn;
}

// Track pending channel approvals
interface PendingApproval {
    sessionId: string;
    agentId: string;
    workspaceId: string;
    userId: string;
    connectionId: string;
    threadId: string;
}

const pendingChannelApprovals = new Map<string, PendingApproval>();

/** Resume a channel approval (called from Telegram callback query handler) */
export async function resolveChannelApproval(
    sessionId: string,
    decision: "approve" | "reject"
): Promise<{ content: string; connectionId: string; threadId: string } | null> {
    const pending = pendingChannelApprovals.get(sessionId);
    if (!pending) {
        logger.warn({ sessionId }, "No pending channel approval found");
        return null;
    }

    pendingChannelApprovals.delete(sessionId);

    try {
        const { graph } = await createAgentGraph(
            pending.agentId,
            pending.workspaceId,
            pending.userId
        );

        const decisions = [{ type: decision }];
        const result = await graph.invoke(
            new Command({ resume: { decisions } }),
            { configurable: { thread_id: sessionId } }
        );

        // Extract response content
        const msgs = result.messages;
        const lastMsg = msgs[msgs.length - 1];
        let content = "";
        if (lastMsg && typeof lastMsg.content === "string") {
            content = lastMsg.content;
        } else if (lastMsg && Array.isArray(lastMsg.content)) {
            content = lastMsg.content
                .filter((c: unknown) => typeof c === "object" && c !== null && "text" in (c as Record<string, unknown>))
                .map((c: unknown) => (c as { text: string }).text)
                .join("");
        }

        if (!content) {
            content = decision === "approve"
                ? "Action approved and executed."
                : "Action was rejected.";
        }

        // Check for further interrupts (chained tool calls)
        const graphState = await graph.getState({
            configurable: { thread_id: sessionId },
        });
        const furtherInterrupts = (
            graphState.tasks as Array<{ interrupts?: Array<{ value?: unknown }> }>
        ).flatMap((t) => t.interrupts || []);

        if (furtherInterrupts.length > 0) {
            // Another tool needs approval — re-store and send new approval
            pendingChannelApprovals.set(sessionId, pending);
            const interruptPayload = furtherInterrupts[0]?.value as {
                toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
            };
            if (sendApprovalFn && interruptPayload?.toolCalls) {
                const approvalText = formatApprovalMessage(interruptPayload.toolCalls);
                await sendApprovalFn(
                    pending.connectionId,
                    pending.threadId,
                    approvalText,
                    sessionId
                );
            }
            // Don't save message yet — more approvals pending
            return { content, connectionId: pending.connectionId, threadId: pending.threadId };
        }

        // Save assistant message
        await messageRepository.create({
            workspaceId: pending.workspaceId,
            sessionId: pending.sessionId,
            role: "assistant",
            content,
            tokenCount: 0,
        });

        return { content, connectionId: pending.connectionId, threadId: pending.threadId };
    } catch (error) {
        logger.error({ error, sessionId }, "Failed to resolve channel approval");
        return {
            content: "Something went wrong while processing your decision.",
            connectionId: pending.connectionId,
            threadId: pending.threadId,
        };
    }
}

function formatApprovalMessage(
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>
): string {
    const lines = ["⚠️ *Approval Required*\n"];
    for (const tc of toolCalls) {
        lines.push(`*Action:* \`${tc.name.replace(/_/g, " ")}\``);
        for (const [k, v] of Object.entries(tc.args)) {
            lines.push(`  • *${k}:* ${String(v).slice(0, 200)}`);
        }
        lines.push("");
    }
    lines.push("Choose an action below:");
    return lines.join("\n");
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
        // Use platformUserId (UUID) for credit tracking and memory scoping
        // For custom bots without a platform user, pass undefined (workspace-level credit check only)
        const graphUserId = message.platformUserId || undefined;
        const { graph } = await createAgentGraph(message.agentId, message.workspaceId, graphUserId);

        const result = await graph.invoke(
            { messages: [new HumanMessage(message.text)] },
            { configurable: { thread_id: sessionId } }
        );

        // Check for HITL interrupts
        const graphState = await graph.getState({
            configurable: { thread_id: sessionId },
        });
        const pendingInterrupts = (
            graphState.tasks as Array<{ interrupts?: Array<{ value?: unknown }> }>
        ).flatMap((t) => t.interrupts || []);

        if (pendingInterrupts.length > 0) {
            const interruptPayload = pendingInterrupts[0]?.value as {
                toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
            };

            if (interruptPayload?.toolCalls && sendApprovalFn && message.threadId) {
                // Store pending approval
                pendingChannelApprovals.set(sessionId, {
                    sessionId,
                    agentId: message.agentId,
                    workspaceId: message.workspaceId,
                    userId: message.externalUserId,
                    connectionId: message.connectionId,
                    threadId: message.threadId,
                });

                // Send approval message with inline keyboard
                const approvalText = formatApprovalMessage(interruptPayload.toolCalls);
                await sendApprovalFn(
                    message.connectionId,
                    message.threadId,
                    approvalText,
                    sessionId
                );

                logger.info(
                    { sessionId, toolCount: interruptPayload.toolCalls.length },
                    "Channel HITL: approval request sent"
                );
            }

            // Update last message timestamp (skip for platform bot — handled by telegram-link repo)
            if (message.connectionId !== "platform-telegram" && message.connectionId !== "platform-slack") {
                await channelRepository.updateLastMessageAt(message.connectionId);
            }
            return; // Don't send normal response — waiting for approval
        }

        // No interrupt — extract and send normal response
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

        // Update last message timestamp (skip for platform bot — handled by telegram-link repo)
        if (message.connectionId !== "platform-telegram" && message.connectionId !== "platform-slack") {
            await channelRepository.updateLastMessageAt(message.connectionId);
        }

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
