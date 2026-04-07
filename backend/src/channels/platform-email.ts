import { randomUUID } from "crypto";
import { logger } from "../lib/logger.ts";
import { emailWorkspaceAddressRepository } from "../repositories/email-workspace-address.repository.ts";
import { emailApprovedSenderRepository } from "../repositories/email-approved-sender.repository.ts";
import { inboundEmailRepository } from "../repositories/inbound-email.repository.ts";
import type { EmailAttachmentMeta } from "../repositories/inbound-email.repository.ts";
import { telegramLinkRepository } from "../repositories/telegram-link.repository.ts";
import { slackLinkRepository } from "../repositories/slack-link.repository.ts";
import { whatsappLinkRepository } from "../repositories/whatsapp-link.repository.ts";
import { ceoService } from "../services/ceo.service.ts";
import { routeMessage } from "./message-router.ts";
import { sendReplyMail } from "../lib/mailer.ts";
import { getStorage } from "../lib/storage.ts";
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
            // Log the full raw payload for debugging
            logger.info({
                cloudflare_payload_keys: Object.keys(payload),
                cloudflare_payload_from: payload.from,
                cloudflare_payload_to: payload.to,
                cloudflare_payload_subject: payload.subject,
                cloudflare_payload_has_text: !!payload.text,
                cloudflare_payload_has_plain: !!payload.plain,
                cloudflare_payload_has_html: !!payload.html,
                cloudflare_payload_has_headers: !!payload.headers,
                cloudflare_payload_headers: payload.headers,
                cloudflare_payload_text_preview: typeof payload.text === 'string' ? payload.text.slice(0, 300) : null,
                cloudflare_payload_html_preview: typeof payload.html === 'string' ? payload.html.slice(0, 300) : null,
                cloudflare_payload_full: payload,
            }, "CLOUDFLARE EMAIL PAYLOAD DEBUG");

            // Extract fields from Cloudflare Email Routing payload
            const fromRaw = (payload.from as string) || "";
            const toRaw = (payload.to as string) || "";
            const subject = (payload.subject as string) || "";
            const rawBodyText = (payload.text as string) || (payload.plain as string) || "";
            const bodyText = extractBodyFromMime(rawBodyText);
            const bodyHtml = (payload.html as string) || "";
            const cc = (payload.cc as string) || "";
            const bcc = (payload.bcc as string) || "";
            const rawHeaders = payload.headers as Record<string, string> | undefined;
            const messageId = rawHeaders?.["message-id"] || (payload.messageId as string) || "";
            const inReplyTo = rawHeaders?.["in-reply-to"] || (payload.inReplyTo as string) || "";
            const references = rawHeaders?.references || (payload.references as string) || "";

            logger.info({
                raw_body_text_preview: rawBodyText.slice(0, 300),
                extracted_body_text: bodyText.slice(0, 300),
                body_html_preview: bodyHtml.slice(0, 300),
            }, "CLOUDFLARE EMAIL BODY EXTRACTION DEBUG");

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
                // Store as spam (no attachment parsing for spam)
                const spamRecord = await inboundEmailRepository.create({
                    workspaceId,
                    emailAddressId: emailConfig.id,
                    fromAddress,
                    fromName,
                    toAddress,
                    subject,
                    bodyText,
                    bodyHtml,
                    cc,
                    bcc,
                    messageId,
                    inReplyTo,
                    references,
                    rawPayload: payload,
                });
                await inboundEmailRepository.updateStatus(
                    spamRecord.id,
                    "spam",
                    `Sender ${fromAddress} not in approved senders list`
                );
                logger.info({ from: fromAddress, workspaceId }, "Email rejected: sender not approved");
                return;
            }

            // Parse and upload attachments from raw MIME
            const attachments = await extractAndUploadAttachments(rawBodyText, workspaceId);
            if (attachments.length > 0) {
                logger.info({ count: attachments.length, files: attachments.map(a => a.filename) }, "Email attachments extracted");
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
                bcc,
                messageId,
                inReplyTo,
                references,
                rawPayload: payload,
                attachments,
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

// ── Attachment Extraction ─────────────────────────────────────────────────────

type RawAttachment = {
    filename: string;
    mimeType: string;
    buffer: Buffer;
    isInline: boolean;
    contentId?: string;
};

/**
 * Walk all MIME parts of a raw email, collecting attachment parts.
 * Returns decoded buffers ready for storage upload.
 */
function extractMimeAttachments(raw: string): RawAttachment[] {
    const results: RawAttachment[] = [];
    collectAttachmentParts(raw, results);
    return results;
}

function collectAttachmentParts(text: string, results: RawAttachment[]): void {
    const splitIdx = findMimeSplit(text);
    if (splitIdx === -1) return;

    const headers = text.slice(0, splitIdx);
    const body = text.slice(splitIdx);

    const contentTypeMatch = headers.match(/^Content-Type:\s*([^\r\n;]+)/im);
    const contentType = contentTypeMatch?.[1]?.trim().toLowerCase() ?? "";

    if (contentType.startsWith("multipart/")) {
        const boundaryMatch = headers.match(/boundary="?([^"\r\n;]+)"?/i);
        if (!boundaryMatch) return;
        const boundary = boundaryMatch[1].trim();
        const parts = body.split(new RegExp(`--${escapeRegex(boundary)}`));
        for (const part of parts) {
            if (!part || part.trimStart().startsWith("--") || part.trim() === "") continue;
            collectAttachmentParts(part.trimStart(), results);
        }
        return;
    }

    // No content-type → outer transport headers, recurse into body
    if (!contentType && /^[A-Za-z-]+:\s/m.test(body.slice(0, 1000))) {
        collectAttachmentParts(body, results);
        return;
    }

    // Check disposition
    const dispositionMatch = headers.match(/^Content-Disposition:\s*([^\r\n;]+)/im);
    const disposition = dispositionMatch?.[1]?.trim().toLowerCase() ?? "";
    const isAttachment = disposition === "attachment" || disposition.startsWith("attachment");
    const isInline = disposition === "inline" || disposition.startsWith("inline");

    // Get filename from Content-Disposition or Content-Type
    let filename =
        headers.match(/Content-Disposition:[^\r\n]*filename\*?=(?:UTF-8'')?["']?([^"'\r\n;]+)["']?/i)?.[1]?.trim() ||
        headers.match(/Content-Type:[^\r\n]*name\*?=(?:UTF-8'')?["']?([^"'\r\n;]+)["']?/i)?.[1]?.trim() ||
        "";

    // Decode RFC 5987 encoded filenames (=?UTF-8?B?...?= or =?UTF-8?Q?...?=)
    if (filename.startsWith("=?")) {
        filename = decodeMimeWord(filename);
    }

    const contentId = headers.match(/^Content-ID:\s*<([^>]+)>/im)?.[1]?.trim();

    // Only collect if it's an explicit attachment, or inline with a filename (inline images)
    if (!isAttachment && !(isInline && filename) && !contentId) return;
    if (!filename && !contentId) return;
    if (!filename) filename = contentId ? `inline-${contentId.replace(/[^\w.]/g, "_")}` : "attachment";

    // Skip text/plain and text/html parts — those are the body
    if (contentType.startsWith("text/plain") || contentType.startsWith("text/html")) return;

    const encodingMatch = headers.match(/^Content-Transfer-Encoding:\s*([^\r\n]+)/im);
    const encoding = encodingMatch?.[1]?.trim().toLowerCase() ?? "";

    let buffer: Buffer;
    try {
        if (encoding === "base64") {
            buffer = Buffer.from(body.replace(/\s/g, ""), "base64");
        } else if (encoding === "quoted-printable") {
            buffer = Buffer.from(decodeQuotedPrintable(body.trim()), "binary");
        } else {
            buffer = Buffer.from(body.trim(), "binary");
        }
    } catch {
        return; // Skip unparseable parts
    }

    results.push({
        filename: filename.replace(/[^\w.\-\s]/g, "_").slice(0, 200),
        mimeType: contentType || "application/octet-stream",
        buffer,
        isInline: isInline || !!contentId,
        contentId,
    });
}

/**
 * Extract attachments from raw MIME email and upload them to MinIO/S3.
 * Returns attachment metadata for storage in the DB.
 */
async function extractAndUploadAttachments(
    rawEmail: string,
    workspaceId: string
): Promise<EmailAttachmentMeta[]> {
    if (!rawEmail) return [];

    const raw = extractMimeAttachments(rawEmail);
    if (raw.length === 0) return [];

    const storage = getStorage();
    const results: EmailAttachmentMeta[] = [];

    for (const att of raw) {
        try {
            const storageKey = `${workspaceId}/email-attachments/${randomUUID()}-${att.filename}`;
            await storage.put(storageKey, att.buffer, att.mimeType);
            results.push({
                filename: att.filename,
                mimeType: att.mimeType,
                size: att.buffer.length,
                storageKey,
                isInline: att.isInline,
                contentId: att.contentId,
            });
        } catch (err) {
            logger.warn({ err, filename: att.filename }, "Failed to upload email attachment");
        }
    }

    return results;
}

function decodeMimeWord(encoded: string): string {
    // Handle =?charset?B?base64?= and =?charset?Q?qp?=
    return encoded.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, _charset, encoding, text) => {
        try {
            if (encoding.toUpperCase() === "B") {
                return Buffer.from(text, "base64").toString("utf-8");
            } else {
                return decodeQuotedPrintable(text.replace(/_/g, " "));
            }
        } catch {
            return text;
        }
    });
}

/**
 * Extract clean plain-text body from a raw MIME email string.
 * Cloudflare Workers sometimes forward the raw RFC 2822 source as `text`.
 * Handles transport headers (Received, ARC, DKIM) → message headers → multipart body.
 */
function extractBodyFromMime(raw: string): string {
    if (!raw) return "";

    const looksLikeMime = /^(Received:|MIME-Version:|Content-Type:|DKIM-Signature:|ARC-|From:|To:|Subject:)/m.test(raw);
    if (!looksLikeMime) return raw.trim();

    return parseMimePart(raw) ?? raw.trim();
}

/**
 * Recursively parse a MIME part and return the first text/plain content found.
 * Handles: transport headers → message envelope → multipart → text/plain
 */
function parseMimePart(text: string): string | null {
    const splitIdx = findMimeSplit(text);
    if (splitIdx === -1) return null;

    const headers = text.slice(0, splitIdx);
    const body = text.slice(splitIdx);

    const contentTypeMatch = headers.match(/^Content-Type:\s*([^\r\n;]+)/im);
    const contentType = contentTypeMatch?.[1]?.trim().toLowerCase() ?? "";

    // No Content-Type means this is likely the transport header section.
    // The body is the actual message (which has its own headers) — recurse into it.
    if (!contentType) {
        if (/^[A-Za-z-]+:\s/m.test(body.slice(0, 1000))) {
            return parseMimePart(body);
        }
        return body.trim() || null;
    }

    if (contentType.startsWith("multipart/")) {
        const boundaryMatch = headers.match(/boundary="?([^"\r\n;]+)"?/i);
        if (!boundaryMatch) return null;
        const boundary = boundaryMatch[1].trim();

        const parts = body.split(new RegExp(`--${escapeRegex(boundary)}`));
        // Prefer text/plain, fallback to first parseable part
        let fallback: string | null = null;
        for (const part of parts) {
            if (!part || part.trimStart().startsWith("--") || part.trim() === "") continue;
            const result = parseMimePart(part.trimStart());
            if (result && !fallback) fallback = result;
            // Check if this part is specifically text/plain
            const partCtMatch = part.match(/^Content-Type:\s*text\/plain/im);
            if (partCtMatch && result) return result;
        }
        return fallback;
    }

    if (contentType.startsWith("text/plain")) {
        const encodingMatch = headers.match(/^Content-Transfer-Encoding:\s*([^\r\n]+)/im);
        const encoding = encodingMatch?.[1]?.trim().toLowerCase() ?? "";
        if (encoding === "quoted-printable") return decodeQuotedPrintable(body.trim());
        if (encoding === "base64") return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf-8").trim();
        return body.trim();
    }

    // text/html or other non-text types — skip
    return null;
}

function findMimeSplit(text: string): number {
    const rn = text.indexOf("\r\n\r\n");
    const n = text.indexOf("\n\n");
    if (rn === -1 && n === -1) return -1;
    if (rn === -1) return n + 2;
    if (n === -1) return rn + 4;
    return Math.min(rn + 4, n + 2);
}

function stripMimeHeaders(text: string): string {
    return text.replace(/^([A-Za-z-]+:\s[^\n]*\n)+\n?/, "").trim();
}

function decodeQuotedPrintable(text: string): string {
    return text
        .replace(/=\r?\n/g, "") // soft line breaks
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
