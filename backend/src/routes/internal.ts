import type { FastifyInstance, FastifyRequest } from "fastify";
import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { platformBotConfigRepository } from "../repositories/platform-bot-config.repository.ts";

export async function internalRoutes(fastify: FastifyInstance) {
    // GET /internal/extension/validate-key?key=XXX
    // Used by the extension-bridge service to validate per-workspace API keys
    fastify.get("/extension/validate-key", async (request, reply) => {
        const query = request.query as { key?: string };
        const apiKey = query.key;

        if (!apiKey) {
            return reply.status(400).send({ error: "Missing API key" });
        }

        const workspace = await workspaceRepository.findByExtensionApiKey(apiKey);
        if (!workspace) {
            return reply.status(401).send({ error: "Invalid API key", valid: false });
        }

        return { valid: true, workspaceId: workspace.id };
    });

    // GET /internal/platform-bots/:platform/restart
    // Used by admin panel to restart platform bots after config changes
    fastify.get("/platform-bots/:platform/restart", async (request, reply) => {
        const { platform } = request.params as { platform: string };

        if (platform === "telegram") {
            await channelManager.shutdownPlatformTelegram();
            await channelManager.initializePlatformTelegram();
            const config = await platformBotConfigRepository.findByPlatform("telegram");
            return { success: true, status: config?.status ?? "inactive", botUsername: config?.botUsername };
        }

        if (platform === "slack") {
            await channelManager.shutdownPlatformSlack();
            await channelManager.initializePlatformSlack();
            const config = await platformBotConfigRepository.findByPlatform("slack");
            return { success: true, status: config?.status ?? "inactive", botName: config?.botName };
        }

        if (platform === "whatsapp") {
            await channelManager.shutdownPlatformWhatsApp();
            await channelManager.initializePlatformWhatsApp();
            const config = await platformBotConfigRepository.findByPlatform("whatsapp");
            return { success: true, status: config?.status ?? "inactive", botName: config?.botName };
        }

        return reply.status(400).send({ error: "Invalid platform. Use 'telegram', 'slack', or 'whatsapp'." });
    });

    // GET /internal/platform-bots/status
    // Returns current status of platform bots
    fastify.get("/platform-bots/status", async () => {
        const configs = await platformBotConfigRepository.findAll();
        return {
            telegram: {
                running: channelManager.getPlatformTelegramBot() !== null,
                config: configs.find(c => c.platform === "telegram") ?? null,
            },
            slack: {
                running: channelManager.getPlatformSlackBot() !== null,
                config: configs.find(c => c.platform === "slack") ?? null,
            },
            whatsapp: {
                running: channelManager.getPlatformWhatsAppBot() !== null,
                config: configs.find(c => c.platform === "whatsapp") ?? null,
            },
        };
    });
}
