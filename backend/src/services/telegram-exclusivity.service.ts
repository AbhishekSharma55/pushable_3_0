import { channelRepository } from "../repositories/channel.repository.ts";
import { telegramLinkRepository } from "../repositories/telegram-link.repository.ts";
import { AppError } from "../lib/errors.ts";

export const telegramExclusivityService = {
    /**
     * Check that a Telegram user ID is NOT in any custom bot's allowedUserIds.
     * Throws 409 if found.
     */
    async assertNotInCustomBot(telegramUserId: string, excludeConnectionId?: string): Promise<void> {
        const connections = await channelRepository.findTelegramConnectionsWithUser(
            telegramUserId,
            excludeConnectionId
        );
        if (connections.length > 0) {
            const botName = connections[0].name;
            throw new AppError(
                `This Telegram account is already connected to custom bot "${botName}". Remove it from that bot first.`,
                409,
                "TELEGRAM_USER_IN_CUSTOM_BOT"
            );
        }
    },

    /**
     * Check that a Telegram user ID is NOT linked to the universal platform bot.
     * Throws 409 if found.
     */
    async assertNotInUniversalBot(telegramUserId: string): Promise<void> {
        const link = await telegramLinkRepository.findByTelegramUserId(telegramUserId);
        if (link) {
            throw new AppError(
                "This Telegram account is connected to the universal bot. Unlink it from the dashboard first.",
                409,
                "TELEGRAM_USER_IN_UNIVERSAL_BOT"
            );
        }
    },

    /**
     * Check that a bot token is NOT already used in another workspace.
     * Throws 409 if found.
     */
    async assertBotTokenNotInUse(botToken: string, excludeWorkspaceId?: string): Promise<void> {
        const connections = await channelRepository.findByBotToken(botToken);
        const conflict = excludeWorkspaceId
            ? connections.find((c) => c.workspaceId !== excludeWorkspaceId)
            : connections[0];

        if (conflict) {
            throw new AppError(
                "This bot token is already used in another workspace.",
                409,
                "BOT_TOKEN_IN_USE"
            );
        }
    },
};
