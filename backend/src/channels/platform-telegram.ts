import { Bot, InlineKeyboard } from "grammy";
import { logger } from "../lib/logger.ts";
import { telegramLinkRepository } from "../repositories/telegram-link.repository.ts";
import { ceoService } from "../services/ceo.service.ts";
import { telegramExclusivityService } from "../services/telegram-exclusivity.service.ts";
import {
    validateAndConsume,
} from "../lib/telegram-verification.ts";
import { AppError } from "../lib/errors.ts";
import { routeMessage, resolveChannelApproval } from "./message-router.ts";
import type { NormalizedMessage, NormalizedResponse } from "./types.ts";

const MAX_TELEGRAM_LENGTH = 4096;
const PLATFORM_CONNECTION_ID = "platform-telegram";
const VERIFICATION_CODE_PATTERN = /^[A-Fa-f0-9]{6}$/;

export class PlatformTelegramBot {
    private bot: Bot;
    private botUsername: string | null = null;

    constructor(token: string) {
        this.bot = new Bot(token);
        this.setupHandlers();
    }

    private setupHandlers(): void {
        // /start command
        this.bot.command("start", async (ctx) => {
            if (!ctx.from) return;

            const telegramUserId = String(ctx.from.id);
            const link = await telegramLinkRepository.findByTelegramUserId(telegramUserId);

            if (link) {
                // Update chat info if needed
                telegramLinkRepository
                    .updateChatInfo(
                        telegramUserId,
                        String(ctx.chat.id),
                        ctx.from.username,
                        ctx.from.first_name
                    )
                    .catch((err) =>
                        logger.warn({ err }, "Failed to update chat info")
                    );

                await ctx.reply(
                    "Welcome back! You're already linked. Just send me a message and your CEO agent will respond."
                );
            } else {
                await ctx.reply(
                    "Welcome to Pushable AI!\n\n" +
                    "To get started, go to your Pushable dashboard → Channels → Telegram and click \"Connect Telegram\".\n\n" +
                    "You'll receive a 6-character verification code. Send that code here to link your account."
                );
            }
        });

        // Text messages — verification codes + regular messages
        this.bot.on("message:text", async (ctx) => {
            if (!ctx.from) return;

            const telegramUserId = String(ctx.from.id);
            const chatId = String(ctx.chat.id);
            const text = ctx.message.text.trim();

            // Check if it's a verification code
            if (VERIFICATION_CODE_PATTERN.test(text)) {
                const result = validateAndConsume(text);
                if (result) {
                    try {
                        // Check exclusivity: ensure this Telegram account isn't in any custom bot
                        await telegramExclusivityService.assertNotInCustomBot(telegramUserId);

                        await telegramLinkRepository.create({
                            telegramUserId,
                            telegramUsername: ctx.from.username,
                            telegramFirstName: ctx.from.first_name,
                            telegramChatId: chatId,
                            workspaceId: result.workspaceId,
                            userId: result.userId,
                        });

                        await ctx.reply(
                            "Successfully linked! You can now send me messages and your CEO agent will respond."
                        );
                        return;
                    } catch (error: unknown) {
                        if (error instanceof AppError) {
                            await ctx.reply(error.message);
                        } else {
                            const msg = error instanceof Error ? error.message : String(error);
                            if (msg.includes("unique") || msg.includes("duplicate")) {
                                await ctx.reply(
                                    "This Telegram account is already linked to a workspace. " +
                                    "Please unlink it from your dashboard first before linking to a new workspace."
                                );
                            } else {
                                logger.error({ error, telegramUserId }, "Failed to create telegram link");
                                await ctx.reply("Something went wrong linking your account. Please try again.");
                            }
                        }
                        return;
                    }
                }
                // Code didn't match — fall through to regular message handling
            }

            // Look up the user's workspace link
            const link = await telegramLinkRepository.findByTelegramUserId(telegramUserId);
            if (!link) {
                await ctx.reply(
                    "You haven't linked your Telegram account yet.\n\n" +
                    "Go to your Pushable dashboard → Channels → Telegram and click \"Connect Telegram\" to get a verification code."
                );
                return;
            }

            // Update chat info (fire-and-forget)
            telegramLinkRepository
                .updateChatInfo(
                    telegramUserId,
                    chatId,
                    ctx.from.username,
                    ctx.from.first_name
                )
                .catch((err) =>
                    logger.warn({ err }, "Failed to update chat info")
                );

            // Update last message time
            telegramLinkRepository
                .updateLastMessageAt(telegramUserId)
                .catch((err) =>
                    logger.warn({ err }, "Failed to update last message time")
                );

            // Get the CEO agent for this workspace
            let ceo;
            try {
                ceo = await ceoService.getOrCreateCEO(link.workspaceId);
            } catch (error) {
                logger.error({ error, workspaceId: link.workspaceId }, "Failed to get CEO agent");
                await ctx.reply("Something went wrong. Please try again later.");
                return;
            }

            // Build normalized message and route to agent
            const message: NormalizedMessage = {
                connectionId: PLATFORM_CONNECTION_ID,
                channelType: "telegram",
                workspaceId: link.workspaceId,
                agentId: ceo.id,
                platformUserId: link.userId || undefined,
                externalUserId: telegramUserId,
                externalUsername: ctx.from.username || ctx.from.first_name,
                text,
                threadId: chatId,
                messageId: String(ctx.message.message_id),
                raw: ctx.message,
            };

            await ctx.replyWithChatAction("typing");
            await routeMessage(message);
        });

        // HITL approval callback queries
        this.bot.on("callback_query:data", async (ctx) => {
            const data = ctx.callbackQuery.data;
            if (!data.startsWith("hitl:")) return;

            const parts = data.split(":");
            const action = parts[1]; // "a" = approve, "r" = reject
            const sessionId = parts.slice(2).join(":");
            const decision = action === "a" ? "approve" : "reject";

            await ctx.answerCallbackQuery({
                text: decision === "approve" ? "Approved!" : "Rejected!",
            });

            const decisionEmoji = decision === "approve" ? "\u2705" : "\u274C";
            const originalText = ctx.callbackQuery.message?.text || "";
            try {
                await ctx.editMessageText(
                    `${originalText}\n\n${decisionEmoji} *${decision === "approve" ? "Approved" : "Rejected"}* by user`,
                    { parse_mode: "Markdown" }
                );
            } catch {
                // Ignore edit errors
            }

            if (ctx.chat) {
                await ctx.replyWithChatAction("typing").catch(() => {});
            }

            try {
                const result = await resolveChannelApproval(
                    sessionId,
                    decision as "approve" | "reject"
                );
                if (result && result.content) {
                    await this.sendMessage(result.threadId, result.content);
                }
            } catch (error) {
                logger.error({ error, sessionId }, "Failed to resolve platform HITL approval");
                if (ctx.chat) {
                    await ctx.reply("Something went wrong processing your decision.").catch(() => {});
                }
            }
        });
    }

    async start(): Promise<void> {
        const me = await this.bot.api.getMe();
        this.botUsername = me.username || null;
        logger.info(
            { username: me.username },
            "Platform Telegram bot verified"
        );

        this.bot.start({
            onStart: () => {
                logger.info("Platform Telegram bot started (polling)");
            },
        }).catch((error) => {
            logger.error(
                { error: error instanceof Error ? error.message : error },
                "Platform Telegram bot polling error"
            );
        });
    }

    async stop(): Promise<void> {
        await this.bot.stop();
        logger.info("Platform Telegram bot stopped");
    }

    getBotUsername(): string | null {
        return this.botUsername;
    }

    getConnectionId(): string {
        return PLATFORM_CONNECTION_ID;
    }

    async sendMessage(chatId: string, text: string): Promise<void> {
        if (text.length <= MAX_TELEGRAM_LENGTH) {
            await this.bot.api
                .sendMessage(chatId, text, { parse_mode: "Markdown" })
                .catch(async () => {
                    await this.bot.api.sendMessage(chatId, text);
                });
        } else {
            let remaining = text;
            while (remaining.length > 0) {
                await this.bot.api
                    .sendMessage(chatId, remaining.slice(0, MAX_TELEGRAM_LENGTH))
                    .catch(() => {});
                remaining = remaining.slice(MAX_TELEGRAM_LENGTH);
            }
        }
    }

    async sendResponse(
        response: NormalizedResponse
    ): Promise<void> {
        if (!response.threadId) return;
        await this.sendMessage(response.threadId, response.text);
    }

    async sendApprovalMessage(
        chatId: string,
        text: string,
        sessionId: string
    ): Promise<void> {
        const keyboard = new InlineKeyboard()
            .text("\u2705 Approve", `hitl:a:${sessionId}`)
            .text("\u274C Reject", `hitl:r:${sessionId}`);

        try {
            await this.bot.api.sendMessage(chatId, text, {
                parse_mode: "Markdown",
                reply_markup: keyboard,
            });
        } catch {
            await this.bot.api
                .sendMessage(chatId, text, { reply_markup: keyboard })
                .catch(() => {});
        }
    }
}
