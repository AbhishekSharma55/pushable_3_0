import { whatsappLinkRepository } from "../repositories/whatsapp-link.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { generateVerificationCode } from "../lib/whatsapp-verification.ts";
import { AppError } from "../lib/errors.ts";

export const whatsappLinkService = {
    isAvailable(): boolean {
        return channelManager.getPlatformWhatsAppBot() !== null;
    },

    async initiateLink(workspaceId: string, userId: string) {
        if (!this.isAvailable()) {
            throw new AppError(
                "Platform WhatsApp bot is not configured",
                400,
                "WHATSAPP_NOT_CONFIGURED"
            );
        }

        // Check if this user already has a link for this workspace
        const existing = await whatsappLinkRepository.findByWorkspaceAndUser(
            workspaceId,
            userId
        );
        if (existing) {
            throw new AppError(
                "You already have a linked WhatsApp account for this workspace",
                400,
                "ALREADY_LINKED"
            );
        }

        const code = generateVerificationCode(workspaceId, userId);

        return {
            code,
            expiresInSeconds: 600,
        };
    },

    async getLinks(workspaceId: string) {
        return whatsappLinkRepository.findByWorkspace(workspaceId);
    },

    async unlinkUser(id: string, workspaceId: string) {
        await whatsappLinkRepository.delete(id, workspaceId);
    },

    async checkLinkStatus(workspaceId: string, userId: string) {
        const link = await whatsappLinkRepository.findByWorkspaceAndUser(
            workspaceId,
            userId
        );
        if (link && link.verifiedAt) {
            return {
                verified: true,
                whatsappPhone: link.whatsappPhone,
                whatsappName: link.whatsappName,
            };
        }
        return { verified: false };
    },
};
