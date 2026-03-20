import { Bot, InlineKeyboard } from "grammy";
import { logger } from "../lib/logger.ts";
import { channelRepository } from "../repositories/channel.repository.ts";
import type {
    ChannelAdapter,
    ChannelConnection,
    NormalizedMessage,
    NormalizedResponse,
} from "./types.ts";

// Will be set by channel-manager after messageRouter is created
let onMessage: ((msg: NormalizedMessage) => Promise<void>) | null = null;
let onApproval: ((sessionId: string, decision: "approve" | "reject") => Promise<{ content: string; connectionId: string; threadId: string } | null>) | null = null;

export function setTelegramMessageHandler(
    handler: (msg: NormalizedMessage) => Promise<void>
) {
    onMessage = handler;
}

export function setTelegramApprovalHandler(
    handler: (sessionId: string, decision: "approve" | "reject") => Promise<{ content: string; connectionId: string; threadId: string } | null>
) {
    onApproval = handler;
}

const MAX_TELEGRAM_LENGTH = 4096;

function isUserAllowed(
    config: Record<string, unknown>,
    userId: string
): boolean {
    const allowedUsers = config.allowedUserIds as string[] | undefined;
    // No allowlist = no one can access (default deny)
    if (!allowedUsers || allowedUsers.length === 0) return false;
    // Wildcard "*" means open access to everyone
    if (allowedUsers.includes("*")) return true;
    return allowedUsers.includes(userId);
}

export class TelegramAdapter implements ChannelAdapter {
    channelType = "telegram" as const;
    private bots = new Map<string, Bot>();
    private connectionConfigs = new Map<string, Record<string, unknown>>();

    async initialize(connection: ChannelConnection): Promise<void> {
        const creds = connection.credentials as { botToken?: string };
        if (!creds.botToken) throw new Error("Missing botToken in credentials");

        const bot = new Bot(creds.botToken);
        this.connectionConfigs.set(connection.id, connection.config || {});

        // Handle /start command for deep-link self-registration
        bot.command("start", async (ctx) => {
            if (!ctx.from) return;
            const payload = ctx.match; // text after /start
            const userId = String(ctx.from.id);
            const username = ctx.from.username || ctx.from.first_name;

            if (payload === `register_${connection.id}`) {
                // Self-registration via QR deep link
                const config = this.connectionConfigs.get(connection.id) || {};
                const allowedUsers = (config.allowedUserIds as string[]) || [];

                if (allowedUsers.includes(userId)) {
                    await ctx.reply(
                        `You're already registered! Go ahead and send me a message.`
                    );
                    return;
                }

                // Add user to allowlist + known users
                const updatedAllowed = [...allowedUsers, userId];
                const knownUsers = (config.knownUsers as Record<string, { username: string; firstName: string }>) || {};
                knownUsers[userId] = {
                    username: ctx.from.username || "",
                    firstName: ctx.from.first_name,
                };
                const updatedConfig = {
                    ...config,
                    allowedUserIds: updatedAllowed,
                    knownUsers,
                };
                this.connectionConfigs.set(connection.id, updatedConfig);

                // Persist to DB
                await channelRepository.update(
                    connection.id,
                    connection.workspaceId,
                    { config: updatedConfig }
                );

                logger.info(
                    {
                        connectionId: connection.id,
                        userId,
                        username,
                    },
                    "Telegram user self-registered via QR deep link"
                );

                await ctx.reply(
                    `Welcome, ${username}! You're now registered and can send messages to this bot.`
                );
                return;
            }

            // Default /start response
            const config = this.connectionConfigs.get(connection.id) || {};
            if (!isUserAllowed(config, userId)) {
                await ctx.reply(
                    "Sorry, you're not authorized to use this bot. Please contact the administrator."
                );
                return;
            }

            await ctx.reply("Hello! Send me a message and I'll respond.");
        });

        bot.on("message:text", async (ctx) => {
            if (!onMessage) return;

            const userId = String(ctx.from.id);

            // Check user allowlist
            const config = this.connectionConfigs.get(connection.id) || {};
            if (!isUserAllowed(config, userId)) {
                await ctx.reply(
                    "Sorry, you're not authorized to use this bot. Please contact the administrator."
                );
                return;
            }

            // Track known user info (username, firstName, chatId)
            const knownUsers = (config.knownUsers as Record<string, { username: string; firstName: string; chatId?: string }>) || {};
            const currentInfo = knownUsers[userId];
            const newInfo = {
                username: ctx.from.username || "",
                firstName: ctx.from.first_name,
                chatId: String(ctx.chat.id),
            };
            // Only persist if info changed
            if (
                !currentInfo ||
                currentInfo.username !== newInfo.username ||
                currentInfo.firstName !== newInfo.firstName ||
                currentInfo.chatId !== newInfo.chatId
            ) {
                knownUsers[userId] = newInfo;
                const updatedConfig = { ...config, knownUsers };
                this.connectionConfigs.set(connection.id, updatedConfig);
                // Fire-and-forget DB update
                channelRepository
                    .update(connection.id, connection.workspaceId, {
                        config: updatedConfig,
                    })
                    .catch((err) =>
                        logger.warn({ err }, "Failed to persist known user info")
                    );
            }

            const message: NormalizedMessage = {
                connectionId: connection.id,
                channelType: "telegram",
                workspaceId: connection.workspaceId,
                agentId: connection.agentId,
                externalUserId: userId,
                externalUsername: ctx.from.username || ctx.from.first_name,
                text: ctx.message.text,
                threadId: String(ctx.chat.id),
                messageId: String(ctx.message.message_id),
                raw: ctx.message,
            };

            await ctx.replyWithChatAction("typing");
            await onMessage(message);
        });

        // Handle HITL approval callback queries (inline keyboard buttons)
        bot.on("callback_query:data", async (ctx) => {
            const data = ctx.callbackQuery.data;
            if (!data.startsWith("hitl:")) return;

            const parts = data.split(":");
            const action = parts[1]; // "a" = approve, "r" = reject
            const sessionId = parts.slice(2).join(":"); // rest is sessionId
            const decision = action === "a" ? "approve" : "reject";

            // Acknowledge immediately
            await ctx.answerCallbackQuery({
                text: decision === "approve" ? "Approved!" : "Rejected!",
            });

            // Update the approval message to show decision
            const decisionEmoji = decision === "approve" ? "✅" : "❌";
            const originalText = ctx.callbackQuery.message?.text || "";
            try {
                await ctx.editMessageText(
                    `${originalText}\n\n${decisionEmoji} *${decision === "approve" ? "Approved" : "Rejected"}* by user`,
                    { parse_mode: "Markdown" }
                );
            } catch {
                // Ignore edit errors (message might be too old)
            }

            // Send typing indicator
            if (ctx.chat) {
                await ctx.replyWithChatAction("typing").catch(() => {});
            }

            // Resolve the approval via message router
            if (onApproval) {
                try {
                    const result = await onApproval(sessionId, decision as "approve" | "reject");
                    if (result && result.content) {
                        // Send the agent's response after approval
                        await this.sendMessage(connection.id, {
                            text: result.content,
                            threadId: result.threadId,
                        });
                    }
                } catch (error) {
                    logger.error({ error, sessionId }, "Failed to resolve HITL approval");
                    if (ctx.chat) {
                        await ctx.reply("Something went wrong processing your decision.").catch(() => {});
                    }
                }
            }
        });

        // Validate token before starting
        const me = await bot.api.getMe();
        logger.info(
            { connectionId: connection.id, username: me.username },
            "Telegram bot token verified"
        );

        this.bots.set(connection.id, bot);

        // Start long polling in background — catch errors so they don't crash the process
        bot.start({
            onStart: () => {
                logger.info(
                    { connectionId: connection.id },
                    "Telegram bot started (polling)"
                );
            },
        }).catch((error) => {
            logger.error(
                { connectionId: connection.id, error: error instanceof Error ? error.message : error },
                "Telegram bot polling error"
            );
        });
    }

    async shutdown(connectionId: string): Promise<void> {
        const bot = this.bots.get(connectionId);
        if (bot) {
            await bot.stop();
            this.bots.delete(connectionId);
            logger.info({ connectionId }, "Telegram bot stopped");
        }
    }

    async sendMessage(
        connectionId: string,
        response: NormalizedResponse
    ): Promise<void> {
        const bot = this.bots.get(connectionId);
        if (!bot || !response.threadId) return;

        const chatId = response.threadId;
        const text = response.text;

        // Split long messages
        if (text.length <= MAX_TELEGRAM_LENGTH) {
            await bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(async () => {
                // Retry without markdown if parse fails
                await bot.api.sendMessage(chatId, text);
            });
        } else {
            const chunks: string[] = [];
            let remaining = text;
            while (remaining.length > 0) {
                chunks.push(remaining.slice(0, MAX_TELEGRAM_LENGTH));
                remaining = remaining.slice(MAX_TELEGRAM_LENGTH);
            }
            for (const chunk of chunks) {
                await bot.api.sendMessage(chatId, chunk).catch(() => {});
            }
        }
    }

    getBot(connectionId: string): Bot | undefined {
        return this.bots.get(connectionId);
    }

    updateConfig(connectionId: string, config: Record<string, unknown>): void {
        this.connectionConfigs.set(connectionId, config);
    }

    getConfig(connectionId: string): Record<string, unknown> {
        return this.connectionConfigs.get(connectionId) || {};
    }

    async getBotInfo(
        connectionId: string
    ): Promise<{ username: string; firstName: string } | null> {
        const bot = this.bots.get(connectionId);
        if (!bot) return null;
        try {
            const me = await bot.api.getMe();
            return { username: me.username || "", firstName: me.first_name };
        } catch {
            return null;
        }
    }

    /**
     * Send an approval request message with Approve/Reject inline buttons.
     */
    async sendApprovalMessage(
        connectionId: string,
        chatId: string,
        text: string,
        sessionId: string
    ): Promise<void> {
        const bot = this.bots.get(connectionId);
        if (!bot) return;

        const keyboard = new InlineKeyboard()
            .text("✅ Approve", `hitl:a:${sessionId}`)
            .text("❌ Reject", `hitl:r:${sessionId}`);

        try {
            await bot.api.sendMessage(chatId, text, {
                parse_mode: "Markdown",
                reply_markup: keyboard,
            });
        } catch {
            // Fallback without markdown
            await bot.api.sendMessage(chatId, text, {
                reply_markup: keyboard,
            }).catch(() => {});
        }
    }

    /**
     * Send a direct message to a user by their chat ID.
     * Used by agent tools for proactive messaging.
     */
    async sendDirectMessage(
        connectionId: string,
        chatId: string,
        text: string
    ): Promise<boolean> {
        const bot = this.bots.get(connectionId);
        if (!bot) return false;

        try {
            if (text.length <= MAX_TELEGRAM_LENGTH) {
                await bot.api
                    .sendMessage(chatId, text, { parse_mode: "Markdown" })
                    .catch(async () => {
                        await bot.api.sendMessage(chatId, text);
                    });
            } else {
                let remaining = text;
                while (remaining.length > 0) {
                    await bot.api
                        .sendMessage(
                            chatId,
                            remaining.slice(0, MAX_TELEGRAM_LENGTH)
                        )
                        .catch(() => {});
                    remaining = remaining.slice(MAX_TELEGRAM_LENGTH);
                }
            }
            return true;
        } catch (error) {
            logger.error(
                { connectionId, chatId, error },
                "Failed to send direct message"
            );
            return false;
        }
    }
}
