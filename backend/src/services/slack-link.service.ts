import { slackLinkRepository } from "../repositories/slack-link.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { platformBotConfigRepository } from "../repositories/platform-bot-config.repository.ts";
import { generateVerificationCode } from "../lib/slack-verification.ts";
import { AppError } from "../lib/errors.ts";

export const slackLinkService = {
    isAvailable(): boolean {
        return channelManager.getPlatformSlackBot() !== null;
    },

    async getInstallUrl(): Promise<string | null> {
        // Try DB config first, then env var
        let clientId: string | undefined;
        try {
            const dbConfig = await platformBotConfigRepository.findByPlatform("slack");
            clientId = (dbConfig?.config as { clientId?: string })?.clientId;
        } catch { /* ignore */ }
        if (!clientId) clientId = process.env.SLACK_CLIENT_ID;
        if (!clientId) return null;

        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
        return `${baseUrl}/slack/oauth/install`;
    },

    async initiateLink(workspaceId: string, userId: string) {
        if (!this.isAvailable()) {
            throw new AppError(
                "Platform Slack bot is not configured",
                400,
                "SLACK_NOT_CONFIGURED"
            );
        }

        // Check if this user already has a link for this workspace
        const existing = await slackLinkRepository.findByWorkspaceAndUser(
            workspaceId,
            userId
        );
        if (existing) {
            throw new AppError(
                "You already have a linked Slack account for this workspace",
                400,
                "ALREADY_LINKED"
            );
        }

        const code = generateVerificationCode(workspaceId, userId);
        const installUrl = await this.getInstallUrl();

        return {
            code,
            installUrl,
            expiresInSeconds: 600,
        };
    },

    async getLinks(workspaceId: string) {
        return slackLinkRepository.findByWorkspace(workspaceId);
    },

    async unlinkUser(id: string, workspaceId: string) {
        await slackLinkRepository.delete(id, workspaceId);
    },

    async checkLinkStatus(workspaceId: string, userId: string) {
        const link = await slackLinkRepository.findByWorkspaceAndUser(
            workspaceId,
            userId
        );
        if (link && link.verifiedAt) {
            return {
                verified: true,
                slackUsername: link.slackUsername,
                slackDisplayName: link.slackDisplayName,
            };
        }
        return { verified: false };
    },
};
