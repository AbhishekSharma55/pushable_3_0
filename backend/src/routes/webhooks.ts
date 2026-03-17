import type { FastifyInstance } from "fastify";
import { channelRepository } from "../repositories/channel.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { logger } from "../lib/logger.ts";

export async function webhookRoutes(fastify: FastifyInstance) {
    // POST /webhooks/telegram/:connectionId
    fastify.post("/webhooks/telegram/:connectionId", async (request, reply) => {
        const { connectionId } = request.params as { connectionId: string };

        try {
            const connection = await channelRepository.findByIdGlobal(connectionId);
            if (!connection || connection.status !== "active") {
                return reply.status(200).send({ ok: true });
            }

            const telegramAdapter = channelManager.getTelegramAdapter();
            const bot = telegramAdapter.getBot(connectionId);
            if (bot) {
                await bot.handleUpdate(request.body as Parameters<typeof bot.handleUpdate>[0]);
            }
        } catch (error) {
            logger.error({ connectionId, error }, "Telegram webhook error");
        }

        return reply.status(200).send({ ok: true });
    });

    // POST /webhooks/slack/events
    fastify.post("/webhooks/slack/events", async (request, reply) => {
        const body = request.body as Record<string, unknown>;

        // Handle Slack URL verification challenge
        if (body.type === "url_verification") {
            return reply.send({ challenge: body.challenge });
        }

        if (body.type !== "event_callback") {
            return reply.status(200).send({ ok: true });
        }

        const event = body.event as Record<string, unknown>;
        if (!event) return reply.status(200).send({ ok: true });

        const teamId = body.team_id as string;

        try {
            // Find connection by team ID
            const connections = await channelRepository.findActiveConnections();
            const connection = connections.find((c) => {
                const config = c.config as Record<string, unknown>;
                return c.channelType === "slack" && config.teamId === teamId;
            });

            if (connection) {
                const slackAdapter = channelManager.getSlackAdapter();
                await slackAdapter.handleEvent(connection.id, event);
            }
        } catch (error) {
            logger.error({ teamId, error }, "Slack webhook error");
        }

        return reply.status(200).send({ ok: true });
    });

    // POST /webhooks/slack/interactive (future use)
    fastify.post("/webhooks/slack/interactive", async (_request, reply) => {
        return reply.status(200).send({ ok: true });
    });
}
