import { telegramLinkRepository } from "../repositories/telegram-link.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { generateVerificationCode } from "../lib/telegram-verification.ts";
import { AppError } from "../lib/errors.ts";

export const telegramLinkService = {
    isAvailable(): boolean {
        return !!process.env.TELEGRAM_BOT_TOKEN;
    },

    getBotUsername(): string | null {
        const bot = channelManager.getPlatformTelegramBot();
        return bot?.getBotUsername() ?? null;
    },

    async initiateLink(workspaceId: string, userId: string) {
        if (!this.isAvailable()) {
            throw new AppError(
                "Platform Telegram bot is not configured",
                400,
                "TELEGRAM_NOT_CONFIGURED"
            );
        }

        // Check if this user already has a link for this workspace
        const existing = await telegramLinkRepository.findByWorkspaceAndUser(
            workspaceId,
            userId
        );
        if (existing) {
            throw new AppError(
                "You already have a linked Telegram account for this workspace",
                400,
                "ALREADY_LINKED"
            );
        }

        const code = generateVerificationCode(workspaceId, userId);
        const botUsername = this.getBotUsername();

        return {
            code,
            botUsername,
            botLink: botUsername ? `https://t.me/${botUsername}` : null,
            expiresInSeconds: 600,
        };
    },

    async getLinks(workspaceId: string) {
        return telegramLinkRepository.findByWorkspace(workspaceId);
    },

    async unlinkUser(id: string, workspaceId: string) {
        await telegramLinkRepository.delete(id, workspaceId);
    },

    async checkLinkStatus(workspaceId: string, userId: string) {
        const link = await telegramLinkRepository.findByWorkspaceAndUser(
            workspaceId,
            userId
        );
        if (link && link.verifiedAt) {
            return {
                verified: true,
                telegramUsername: link.telegramUsername,
                telegramFirstName: link.telegramFirstName,
            };
        }
        return { verified: false };
    },
};
