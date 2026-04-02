import { channelRepository } from "../repositories/channel.repository.ts";
import { TelegramAdapter, setTelegramMessageHandler, setTelegramApprovalHandler } from "./telegram.channel.ts";
import { SlackAdapter, setSlackMessageHandler } from "./slack.channel.ts";
import { PlatformTelegramBot } from "./platform-telegram.ts";
import { routeMessage, setResponseSender, setApprovalSender, resolveChannelApproval } from "./message-router.ts";
import { logger } from "../lib/logger.ts";
import type {
    ChannelAdapter,
    ChannelConnection,
    NormalizedResponse,
} from "./types.ts";

const PLATFORM_CONNECTION_ID = "platform-telegram";

class ChannelManager {
    private adapters = new Map<
        string,
        { adapter: ChannelAdapter; connection: ChannelConnection }
    >();
    private telegramAdapter = new TelegramAdapter();
    private slackAdapter = new SlackAdapter();
    private platformTelegramBot: PlatformTelegramBot | null = null;
    private initialized = false;

    private setupHandlers() {
        if (this.initialized) return;
        setTelegramMessageHandler(routeMessage);
        setSlackMessageHandler(routeMessage);
        setResponseSender((connectionId, response) =>
            this.sendMessage(connectionId, response)
        );
        // Wire HITL approval flow for Telegram (per-workspace + platform)
        setApprovalSender((connectionId, chatId, text, sessionId) => {
            if (connectionId === PLATFORM_CONNECTION_ID && this.platformTelegramBot) {
                return this.platformTelegramBot.sendApprovalMessage(chatId, text, sessionId);
            }
            return this.telegramAdapter.sendApprovalMessage(connectionId, chatId, text, sessionId);
        });
        setTelegramApprovalHandler(resolveChannelApproval);
        this.initialized = true;
    }

    async initializeConnection(connection: ChannelConnection): Promise<void> {
        this.setupHandlers();

        try {
            const adapter =
                connection.channelType === "telegram"
                    ? this.telegramAdapter
                    : this.slackAdapter;

            await adapter.initialize(connection);
            this.adapters.set(connection.id, { adapter, connection });
            await channelRepository.updateStatus(connection.id, "active");

            logger.info(
                { connectionId: connection.id, type: connection.channelType },
                "Channel connection initialized"
            );
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            await channelRepository.updateStatus(connection.id, "error", errMsg);
            logger.error(
                { connectionId: connection.id, error: errMsg },
                "Failed to initialize channel connection"
            );
            throw error;
        }
    }

    async shutdownConnection(connectionId: string): Promise<void> {
        const entry = this.adapters.get(connectionId);
        if (!entry) return;

        await entry.adapter.shutdown(connectionId);
        this.adapters.delete(connectionId);
        await channelRepository.updateStatus(connectionId, "inactive");

        logger.info({ connectionId }, "Channel connection shut down");
    }

    async sendMessage(
        connectionId: string,
        response: NormalizedResponse
    ): Promise<void> {
        // Route to platform bot if applicable
        if (connectionId === PLATFORM_CONNECTION_ID && this.platformTelegramBot) {
            await this.platformTelegramBot.sendResponse(response);
            return;
        }

        const entry = this.adapters.get(connectionId);
        if (!entry) return;
        await entry.adapter.sendMessage(connectionId, response);
    }

    async initializePlatformTelegram(): Promise<void> {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            logger.info("No TELEGRAM_BOT_TOKEN set — platform Telegram bot disabled");
            return;
        }

        this.setupHandlers();

        try {
            this.platformTelegramBot = new PlatformTelegramBot(token);
            await this.platformTelegramBot.start();
            logger.info("Platform Telegram bot initialized");
        } catch (error) {
            logger.error(
                { error: error instanceof Error ? error.message : error },
                "Failed to initialize platform Telegram bot"
            );
            this.platformTelegramBot = null;
        }
    }

    async shutdownPlatformTelegram(): Promise<void> {
        if (this.platformTelegramBot) {
            await this.platformTelegramBot.stop();
            this.platformTelegramBot = null;
        }
    }

    getPlatformTelegramBot(): PlatformTelegramBot | null {
        return this.platformTelegramBot;
    }

    async initializeAllActive(): Promise<void> {
        this.setupHandlers();

        try {
            const connections = await channelRepository.findActiveConnections();
            logger.info(
                { count: connections.length },
                "Initializing active channel connections"
            );

            for (const conn of connections) {
                try {
                    const connection = conn as unknown as ChannelConnection;
                    await this.initializeConnection(connection);
                } catch (error) {
                    logger.error(
                        { connectionId: conn.id, error },
                        "Failed to initialize channel connection on startup"
                    );
                }
            }
        } catch (error) {
            logger.error({ error }, "Failed to initialize channel connections");
        }
    }

    getAdapter(connectionId: string) {
        return this.adapters.get(connectionId);
    }

    getSlackAdapter(): SlackAdapter {
        return this.slackAdapter;
    }

    getTelegramAdapter(): TelegramAdapter {
        return this.telegramAdapter;
    }
}

export const channelManager = new ChannelManager();
