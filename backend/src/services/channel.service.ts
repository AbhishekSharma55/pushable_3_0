import { channelRepository } from "../repositories/channel.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { NotFoundError, AppError } from "../lib/errors.ts";
import { Bot } from "grammy";
import { WebClient } from "@slack/web-api";
import type { ChannelConnection } from "../channels/types.ts";

export const channelService = {
    async createConnection(
        data: {
            agentId: string;
            channelType: "telegram" | "slack";
            name: string;
            credentials: Record<string, unknown>;
            config?: Record<string, unknown>;
        },
        workspaceId: string
    ) {
        const connection = await channelRepository.create({
            ...data,
            workspaceId,
        });

        try {
            await channelManager.initializeConnection(
                connection as unknown as ChannelConnection
            );
        } catch {
            // Status already set to 'error' by channel manager
        }

        // Return without credentials
        const { credentials: _, ...safe } = connection;
        return safe;
    },

    async getConnections(workspaceId: string) {
        const connections = await channelRepository.findByWorkspace(workspaceId);
        return connections.map(({ credentials: _, ...safe }) => safe);
    },

    async testConnection(id: string, workspaceId: string) {
        const connection = await channelRepository.findById(id, workspaceId);
        if (!connection) throw new NotFoundError("Connection not found");

        const creds = connection.credentials as Record<string, string>;

        if (connection.channelType === "telegram") {
            if (!creds.botToken) throw new AppError("Missing bot token", 400, "MISSING_TOKEN");
            try {
                const bot = new Bot(creds.botToken);
                const me = await bot.api.getMe();
                return {
                    success: true,
                    details: { botName: me.first_name, username: me.username },
                };
            } catch {
                return { success: false, details: { error: "Invalid bot token" } };
            }
        }

        if (connection.channelType === "slack") {
            if (!creds.botToken) throw new AppError("Missing bot token", 400, "MISSING_TOKEN");
            try {
                const client = new WebClient(creds.botToken);
                const result = await client.auth.test();
                return {
                    success: true,
                    details: { teamName: result.team, botUser: result.user },
                };
            } catch {
                return { success: false, details: { error: "Invalid Slack credentials" } };
            }
        }

        return { success: false, details: { error: "Unknown channel type" } };
    },

    async updateConnection(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            agentId: string;
            credentials: Record<string, unknown>;
            config: Record<string, unknown>;
        }>
    ) {
        const existing = await channelRepository.findById(id, workspaceId);
        if (!existing) throw new NotFoundError("Connection not found");

        const updated = await channelRepository.update(id, workspaceId, data);
        if (!updated) throw new NotFoundError("Connection not found");

        // Re-initialize if credentials changed
        if (data.credentials) {
            try {
                await channelManager.shutdownConnection(id);
                await channelManager.initializeConnection(
                    updated as unknown as ChannelConnection
                );
            } catch {
                // Error status set by channel manager
            }
        }

        // Sync config to live adapter (e.g. allowedUserIds)
        if (data.config && existing.channelType === "telegram") {
            const telegramAdapter = channelManager.getTelegramAdapter();
            telegramAdapter.updateConfig(id, data.config);
        }

        const { credentials: _, ...safe } = updated;
        return safe;
    },

    async getBotInfo(id: string, workspaceId: string) {
        const connection = await channelRepository.findById(id, workspaceId);
        if (!connection) throw new NotFoundError("Connection not found");

        if (connection.channelType === "telegram") {
            const telegramAdapter = channelManager.getTelegramAdapter();
            const info = await telegramAdapter.getBotInfo(id);
            if (!info) throw new AppError("Bot not running", 400, "BOT_NOT_RUNNING");
            return {
                username: info.username,
                firstName: info.firstName,
                deepLink: `https://t.me/${info.username}?start=register_${id}`,
            };
        }

        throw new AppError("Bot info only available for Telegram", 400, "UNSUPPORTED");
    },

    async getConnectionConfig(id: string, workspaceId: string) {
        const connection = await channelRepository.findById(id, workspaceId);
        if (!connection) throw new NotFoundError("Connection not found");
        return connection.config as Record<string, unknown>;
    },

    async deleteConnection(id: string, workspaceId: string) {
        const connection = await channelRepository.findById(id, workspaceId);
        if (!connection) throw new NotFoundError("Connection not found");

        await channelManager.shutdownConnection(id);
        await channelRepository.delete(id, workspaceId);
    },
};
