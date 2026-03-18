import { channelRepository } from "../repositories/channel.repository.ts";
import { TelegramAdapter, setTelegramMessageHandler, setTelegramApprovalHandler } from "./telegram.channel.ts";
import { SlackAdapter, setSlackMessageHandler } from "./slack.channel.ts";
import { routeMessage, setResponseSender, setApprovalSender, resolveChannelApproval } from "./message-router.ts";
import { logger } from "../lib/logger.ts";
import type {
    ChannelAdapter,
    ChannelConnection,
    NormalizedResponse,
} from "./types.ts";

class ChannelManager {
    private adapters = new Map<
        string,
        { adapter: ChannelAdapter; connection: ChannelConnection }
    >();
    private telegramAdapter = new TelegramAdapter();
    private slackAdapter = new SlackAdapter();
    private initialized = false;

    private setupHandlers() {
        if (this.initialized) return;
        setTelegramMessageHandler(routeMessage);
        setSlackMessageHandler(routeMessage);
        setResponseSender((connectionId, response) =>
            this.sendMessage(connectionId, response)
        );
        // Wire HITL approval flow for Telegram
        setApprovalSender((connectionId, chatId, text, sessionId) =>
            this.telegramAdapter.sendApprovalMessage(connectionId, chatId, text, sessionId)
        );
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
        const entry = this.adapters.get(connectionId);
        if (!entry) return;
        await entry.adapter.sendMessage(connectionId, response);
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
