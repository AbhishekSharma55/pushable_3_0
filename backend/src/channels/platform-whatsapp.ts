import { logger } from "../lib/logger.ts";
import { whatsappLinkRepository } from "../repositories/whatsapp-link.repository.ts";
import { ceoService } from "../services/ceo.service.ts";
import { validateAndConsume } from "../lib/whatsapp-verification.ts";
import { routeMessage, resolveChannelApproval } from "./message-router.ts";
import type { NormalizedMessage, NormalizedResponse } from "./types.ts";

const PLATFORM_CONNECTION_ID = "platform-whatsapp";
const VERIFICATION_CODE_PATTERN = /^[A-Fa-f0-9]{6}$/;
const WHATSAPP_API_BASE = "https://graph.facebook.com/v22.0";

export class PlatformWhatsAppBot {
    private phoneNumberId: string;
    private accessToken: string;
    private appSecret: string;
    private webhookVerifyToken: string;

    constructor(config: {
        phoneNumberId: string;
        accessToken: string;
        appSecret: string;
        webhookVerifyToken: string;
    }) {
        this.phoneNumberId = config.phoneNumberId;
        this.accessToken = config.accessToken;
        this.appSecret = config.appSecret;
        this.webhookVerifyToken = config.webhookVerifyToken;
    }

    getConnectionId(): string {
        return PLATFORM_CONNECTION_ID;
    }

    getWebhookVerifyToken(): string {
        return this.webhookVerifyToken;
    }

    /** Handle incoming webhook from WhatsApp Cloud API */
    async handleWebhook(body: Record<string, unknown>): Promise<void> {
        try {
            const entry = (body.entry as Array<Record<string, unknown>>)?.[0];
            if (!entry) return;

            const changes = (entry.changes as Array<Record<string, unknown>>)?.[0];
            if (!changes) return;

            const value = changes.value as Record<string, unknown>;
            if (!value) return;

            // Handle message status updates (delivered, read, etc.)
            if (value.statuses) return;

            const messages = value.messages as Array<Record<string, unknown>>;
            if (!messages || messages.length === 0) return;

            const contacts = value.contacts as Array<Record<string, unknown>>;

            for (const msg of messages) {
                if (msg.type !== "text") continue;

                const from = msg.from as string; // phone number
                const text = ((msg.text as Record<string, unknown>)?.body as string) || "";
                const messageId = msg.id as string;
                const contactName = contacts?.[0]
                    ? ((contacts[0].profile as Record<string, unknown>)?.name as string) || from
                    : from;

                await this.handleIncomingMessage(from, contactName, text, messageId);
            }
        } catch (error) {
            logger.error({ error }, "WhatsApp webhook processing error");
        }
    }

    private async handleIncomingMessage(
        phone: string,
        name: string,
        text: string,
        messageId: string
    ): Promise<void> {
        const trimmedText = text.trim();

        // Check if it's a verification code
        if (VERIFICATION_CODE_PATTERN.test(trimmedText)) {
            const result = validateAndConsume(trimmedText);
            if (result) {
                try {
                    await whatsappLinkRepository.create({
                        whatsappPhone: phone,
                        whatsappName: name,
                        workspaceId: result.workspaceId,
                        userId: result.userId,
                    });

                    await this.sendMessage(
                        phone,
                        "Successfully linked! You can now send me messages and your CEO agent will respond."
                    );
                    return;
                } catch (error: unknown) {
                    const msg = error instanceof Error ? error.message : String(error);
                    if (msg.includes("unique") || msg.includes("duplicate")) {
                        await this.sendMessage(
                            phone,
                            "This WhatsApp number is already linked to a workspace. " +
                            "Please unlink it from your dashboard first before linking to a new workspace."
                        );
                    } else {
                        logger.error({ error, phone }, "Failed to create WhatsApp link");
                        await this.sendMessage(
                            phone,
                            "Something went wrong linking your account. Please try again."
                        );
                    }
                    return;
                }
            }
            // Code didn't match — fall through to regular message handling
        }

        // Look up the user's workspace link
        const link = await whatsappLinkRepository.findByPhone(phone);
        if (!link) {
            await this.sendMessage(
                phone,
                "You haven't linked your WhatsApp account yet.\n\n" +
                "Go to your Pushable dashboard → Channels → WhatsApp and click \"Connect WhatsApp\" to get a verification code."
            );
            return;
        }

        // Update last message time (fire-and-forget)
        whatsappLinkRepository
            .updateLastMessageAt(phone)
            .catch((err) => logger.warn({ err }, "Failed to update WhatsApp last message time"));

        // Get the CEO agent for this workspace
        let ceo;
        try {
            ceo = await ceoService.getOrCreateCEO(link.workspaceId);
        } catch (error) {
            logger.error({ error, workspaceId: link.workspaceId }, "Failed to get CEO agent");
            await this.sendMessage(phone, "Something went wrong. Please try again later.");
            return;
        }

        // Build normalized message and route to agent
        const message: NormalizedMessage = {
            connectionId: PLATFORM_CONNECTION_ID,
            channelType: "whatsapp",
            workspaceId: link.workspaceId,
            agentId: ceo.id,
            platformUserId: link.userId || undefined,
            externalUserId: phone,
            externalUsername: name,
            text: trimmedText,
            threadId: phone,
            messageId,
            raw: { from: phone, name, text: trimmedText },
        };

        await routeMessage(message);
    }

    async sendMessage(to: string, text: string): Promise<void> {
        // WhatsApp has a 4096 character limit per message
        const MAX_LENGTH = 4096;
        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > 0) {
            chunks.push(remaining.slice(0, MAX_LENGTH));
            remaining = remaining.slice(MAX_LENGTH);
        }

        for (const chunk of chunks) {
            try {
                const response = await fetch(
                    `${WHATSAPP_API_BASE}/${this.phoneNumberId}/messages`,
                    {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${this.accessToken}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            messaging_product: "whatsapp",
                            to,
                            type: "text",
                            text: { body: chunk },
                        }),
                    }
                );

                if (!response.ok) {
                    const errBody = await response.text();
                    logger.error(
                        { status: response.status, body: errBody, to },
                        "WhatsApp send message failed"
                    );
                }
            } catch (error) {
                logger.error({ error, to }, "WhatsApp send message error");
            }
        }
    }

    async sendResponse(response: NormalizedResponse): Promise<void> {
        if (!response.threadId) return;
        await this.sendMessage(response.threadId, response.text);
    }

    async sendApprovalMessage(
        chatId: string,
        text: string,
        _sessionId: string
    ): Promise<void> {
        // WhatsApp doesn't support inline buttons for arbitrary messages via Cloud API
        // in the same way as Telegram. Send as text with instructions.
        const approvalText =
            text + "\n\nReply with *approve* or *reject* to proceed.";
        await this.sendMessage(chatId, approvalText);
    }
}
