import { logger } from "../lib/logger.ts";
import { emailWorkspaceAddressRepository } from "../repositories/email-workspace-address.repository.ts";
import { emailApprovedSenderRepository } from "../repositories/email-approved-sender.repository.ts";
import { inboundEmailRepository } from "../repositories/inbound-email.repository.ts";
import { telegramLinkRepository } from "../repositories/telegram-link.repository.ts";
import { slackLinkRepository } from "../repositories/slack-link.repository.ts";
import { whatsappLinkRepository } from "../repositories/whatsapp-link.repository.ts";
import { ceoService } from "../services/ceo.service.ts";
import { routeMessage } from "./message-router.ts";
import { sendReplyMail } from "../lib/mailer.ts";
import type { NormalizedMessage, NormalizedResponse } from "./types.ts";

export const PLATFORM_EMAIL_CONNECTION_ID = "platform-email";

export class PlatformEmailHandler {
    getConnectionId(): string {
        return PLATFORM_EMAIL_CONNECTION_ID;
    }

    /**
     * Handle an inbound email from Cloudflare Email Routing webhook.
     * Cloudflare forwards raw email data as JSON POST.
     */
    async handleInboundEmail(payload: Record<string, unknown>): Promise<void> {
        try {
            // Extract fields from Cloudflare Email Routing payload
            const fromRaw = (payload.from as string) || "";
            const toRaw = (payload.to as string) || "";
            const subject = (payload.subject as string) || "";
            const bodyText = (payload.text as string) || (payload.plain as string) || "";
            const bodyHtml = (payload.html as string) || "";
            const cc = (payload.cc as string) || "";
            const rawHeaders = payload.headers as Record<string, string> | undefined;
            const messageId = rawHeaders?.["message-id"] || (payload.messageId as string) || "";
            const inReplyTo = rawHeaders?.["in-reply-to"] || (payload.inReplyTo as string) || "";
            const references = rawHeaders?.references || (payload.references as string) || "";

            // Parse from address: "Name <email>" or just "email"
            const { email: fromAddress, name: fromName } = parseEmailAddress(fromRaw);
            const { email: toAddress } = parseEmailAddress(toRaw);

            if (!fromAddress || !toAddress) {
                logger.warn({ fromRaw, toRaw }, "Email webhook: missing from/to address");
                return;
            }

            logger.info(
                { from: fromAddress, to: toAddress, subject },
                "Processing inbound email"
            );

            // Look up workspace by recipient email address
            const emailConfig = await emailWorkspaceAddressRepository.findByAddress(
                toAddress.toLowerCase()
            );

            if (!emailConfig) {
                logger.info({ to: toAddress }, "No workspace configured for this email address");
                return;
            }

            if (!emailConfig.enabled) {
                logger.info({ to: toAddress }, "Email address is disabled");
                return;
            }

            const workspaceId = emailConfig.workspaceId;

            // Check approved senders whitelist
            const isApproved = await emailApprovedSenderRepository.isApproved(
                workspaceId,
                fromAddress
            );

            if (!isApproved) {
                // Store as spam
                await inboundEmailRepository.create({
                    workspaceId,
                    emailAddressId: emailConfig.id,
                    fromAddress,
                    fromName,
                    toAddress,
                    subject,
                    bodyText,
                    bodyHtml,
                    cc,
                    messageId,
                    inReplyTo,
                    references,
                    rawPayload: payload,
                });
                // Update status to spam
                const spamEmails = await inboundEmailRepository.findByWorkspace(workspaceId, { limit: 1 });
                if (spamEmails[0]) {
                    await inboundEmailRepository.updateStatus(
                        spamEmails[0].id,
                        "spam",
                        `Sender ${fromAddress} not in approved senders list`
                    );
                }
                logger.info({ from: fromAddress, workspaceId }, "Email rejected: sender not approved");
                return;
            }

            // Create inbound email record
            const inboundEmail = await inboundEmailRepository.create({
                workspaceId,
                emailAddressId: emailConfig.id,
                fromAddress,
                fromName,
                toAddress,
                subject,
                bodyText,
                bodyHtml,
                cc,
                messageId,
                inReplyTo,
                references,
                rawPayload: payload,
            });

            // Get the CEO agent for this workspace
            let ceo;
            try {
                ceo = await ceoService.getOrCreateCEO(workspaceId);
            } catch (error) {
                logger.error({ error, workspaceId }, "Failed to get CEO agent for email");
                await inboundEmailRepository.updateError(
                    inboundEmail.id,
                    "Failed to get CEO agent"
                );
                return;
            }

            // Update status to routing
            await inboundEmailRepository.updateStatus(
                inboundEmail.id,
                "routing",
                `Routing to CEO agent (${ceo.name})`
            );

            // Build the message text with email context
            let messageText = `[Email from ${fromName || fromAddress} <${fromAddress}>]\n`;
            messageText += `Subject: ${subject || "(no subject)"}\n`;
            if (cc) messageText += `CC: ${cc}\n`;
            messageText += `\n${bodyText || "(no body)"}`;

            // Prepend custom instructions if configured
            if (emailConfig.customInstructions) {
                messageText = `[Email Instructions: ${emailConfig.customInstructions}]\n\n${messageText}`;
            }

            // Build normalized message for the message router
            const normalizedMessage: NormalizedMessage = {
                connectionId: PLATFORM_EMAIL_CONNECTION_ID,
                channelType: "email",
                workspaceId,
                agentId: ceo.id,
                externalUserId: fromAddress,
                externalUsername: fromName || fromAddress,
                text: messageText,
                threadId: inboundEmail.id, // Used to link response back to this email
                raw: payload,
            };

            // Update status to processing
            await inboundEmailRepository.updateStatus(
                inboundEmail.id,
                "processing",
                "CEO agent is analyzing the email"
            );

            // Route to CEO agent via existing message router pipeline
            await routeMessage(normalizedMessage);

            // Update status to completed
            await inboundEmailRepository.updateStatus(
                inboundEmail.id,
                "completed",
                "Email processed successfully"
            );
        } catch (error) {
            logger.error({ error }, "Email webhook processing error");
        }
    }

    /** Send a reply email back to the original sender (disabled — replies not sent for now) */
    async sendResponse(response: NormalizedResponse): Promise<void> {
        if (!response.threadId) return;

        try {
            // Just update the inbound email record with the agent's response content
            // without sending an actual reply email
            await inboundEmailRepository.updateReply(response.threadId, response.text);
            logger.info({ threadId: response.threadId }, "Email agent response saved (reply sending disabled)");
            return;

            // Look up the original inbound email by threadId (which is inboundEmail.id)
            const inboundEmail = await inboundEmailRepository.findByIdGlobal(
                response.threadId
            );
            if (!inboundEmail) {
                logger.warn({ threadId: response.threadId }, "No inbound email found for reply");
                return;
            }

            // Look up the workspace email config for the From address
            const emailConfig = inboundEmail.emailAddressId
                ? await emailWorkspaceAddressRepository.findByWorkspace(inboundEmail.workspaceId)
                : null;

            const fromAddress = emailConfig?.address || inboundEmail.toAddress;
            const fromName = emailConfig?.displayName || undefined;

            // Send the reply email
            await sendReplyMail({
                to: inboundEmail.fromAddress,
                subject: inboundEmail.subject || "",
                text: response.text,
                html: `<div style="font-family: sans-serif; white-space: pre-wrap;">${escapeHtml(response.text)}</div>`,
                from: fromAddress,
                fromName,
                inReplyTo: inboundEmail.messageId || undefined,
                references: inboundEmail.messageId || undefined,
            });

            // Update the inbound email record with reply info
            await inboundEmailRepository.updateReply(
                inboundEmail.id,
                response.text
            );

            logger.info(
                { to: inboundEmail.fromAddress, emailId: inboundEmail.id },
                "Email reply sent"
            );
        } catch (error) {
            logger.error({ error, threadId: response.threadId }, "Failed to send email reply");
        }
    }

    /**
     * Handle HITL approval — update email status AND fan out to all admin channels.
     * The admin can approve from Telegram, Slack, WhatsApp, or the web inbox.
     */
    async sendApprovalMessage(
        chatId: string,
        text: string,
        sessionId: string
    ): Promise<void> {
        // For email, chatId is the inbound email ID (threadId)
        try {
            // 1. Update inbox status so the web UI shows approval buttons
            await inboundEmailRepository.updateStatus(
                chatId,
                "awaiting_approval",
                "Agent requires human approval before proceeding"
            );

            // 2. Look up the inbound email to get workspaceId
            const inboundEmail = await inboundEmailRepository.findByIdGlobal(chatId);
            if (!inboundEmail) return;

            const workspaceId = inboundEmail.workspaceId;

            // 3. Build a descriptive approval message for channel notifications
            const emailContext = [
                `📧 *Email Approval Required*\n`,
                `From: ${inboundEmail.fromName || inboundEmail.fromAddress}`,
                `Subject: ${inboundEmail.subject || "(no subject)"}`,
                ``,
                text, // The tool call details from the agent
            ].join("\n");

            // 4. Fan out approval to all connected admin channels
            // This allows the admin to approve from wherever they are

            // Telegram — notify all linked users in this workspace
            const telegramLinks = await telegramLinkRepository.findByWorkspace(workspaceId);
            for (const link of telegramLinks) {
                if (link.telegramChatId && this.channelNotifiers?.telegram) {
                    this.channelNotifiers.telegram(link.telegramChatId, emailContext, sessionId)
                        .catch(err => logger.warn({ err }, "Failed to send email approval to Telegram"));
                }
            }

            // Slack — notify all linked users in this workspace
            const slackLinks = await slackLinkRepository.findByWorkspace(workspaceId);
            for (const link of slackLinks) {
                if (link.slackDmChannelId && this.channelNotifiers?.slack) {
                    this.channelNotifiers.slack(link.slackDmChannelId, emailContext, sessionId)
                        .catch(err => logger.warn({ err }, "Failed to send email approval to Slack"));
                }
            }

            // WhatsApp — notify all linked users in this workspace
            const whatsappLinks = await whatsappLinkRepository.findByWorkspace(workspaceId);
            for (const link of whatsappLinks) {
                if (link.whatsappPhone && this.channelNotifiers?.whatsapp) {
                    this.channelNotifiers.whatsapp(link.whatsappPhone, emailContext, sessionId)
                        .catch(err => logger.warn({ err }, "Failed to send email approval to WhatsApp"));
                }
            }

            logger.info(
                {
                    emailId: chatId,
                    telegramCount: telegramLinks.length,
                    slackCount: slackLinks.length,
                    whatsappCount: whatsappLinks.length,
                },
                "Email approval fanned out to all admin channels"
            );
        } catch (error) {
            logger.error({ error, emailId: chatId }, "Failed to send email approval notifications");
        }
    }

    /** Set channel notifier functions (called by channel-manager after all bots are initialized) */
    setChannelNotifiers(notifiers: {
        telegram?: (chatId: string, text: string, sessionId: string) => Promise<void>;
        slack?: (chatId: string, text: string, sessionId: string) => Promise<void>;
        whatsapp?: (chatId: string, text: string, sessionId: string) => Promise<void>;
    }) {
        this.channelNotifiers = notifiers;
    }

    private channelNotifiers: {
        telegram?: (chatId: string, text: string, sessionId: string) => Promise<void>;
        slack?: (chatId: string, text: string, sessionId: string) => Promise<void>;
        whatsapp?: (chatId: string, text: string, sessionId: string) => Promise<void>;
    } = {};
}

/** Parse "Name <email@domain.com>" or "email@domain.com" */
function parseEmailAddress(raw: string): { email: string; name: string } {
    const match = raw.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
        return { name: match[1].trim().replace(/^["']|["']$/g, ""), email: match[2].trim() };
    }
    return { email: raw.trim(), name: "" };
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
