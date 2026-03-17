import { Bot } from "grammy";
import { logger } from "../lib/logger.ts";
import type {
    ChannelAdapter,
    ChannelConnection,
    NormalizedMessage,
    NormalizedResponse,
} from "./types.ts";

// Will be set by channel-manager after messageRouter is created
let onMessage: ((msg: NormalizedMessage) => Promise<void>) | null = null;

export function setTelegramMessageHandler(
    handler: (msg: NormalizedMessage) => Promise<void>
) {
    onMessage = handler;
}

const MAX_TELEGRAM_LENGTH = 4096;

export class TelegramAdapter implements ChannelAdapter {
    channelType = "telegram" as const;
    private bots = new Map<string, Bot>();

    async initialize(connection: ChannelConnection): Promise<void> {
        const creds = connection.credentials as { botToken?: string };
        if (!creds.botToken) throw new Error("Missing botToken in credentials");

        const bot = new Bot(creds.botToken);

        bot.on("message:text", async (ctx) => {
            if (!onMessage) return;

            const message: NormalizedMessage = {
                connectionId: connection.id,
                channelType: "telegram",
                workspaceId: connection.workspaceId,
                agentId: connection.agentId,
                externalUserId: String(ctx.from.id),
                externalUsername: ctx.from.username || ctx.from.first_name,
                text: ctx.message.text,
                threadId: String(ctx.chat.id),
                messageId: String(ctx.message.message_id),
                raw: ctx.message,
            };

            await ctx.replyWithChatAction("typing");
            await onMessage(message);
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
}
