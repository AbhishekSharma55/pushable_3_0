import type { FastifyInstance } from "fastify";
import { channelRepository } from "../repositories/channel.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { emailWorkspaceAddressRepository } from "../repositories/email-workspace-address.repository.ts";
import { logger } from "../lib/logger.ts";

export async function webhookRoutes(fastify: FastifyInstance) {
    // GET /webhooks/whatsapp — verification challenge from Meta
    fastify.get("/webhooks/whatsapp", async (request, reply) => {
        const query = request.query as Record<string, string>;
        const mode = query["hub.mode"];
        const token = query["hub.verify_token"];
        const challenge = query["hub.challenge"];

        const bot = channelManager.getPlatformWhatsAppBot();
        if (mode === "subscribe" && bot && token === bot.getWebhookVerifyToken()) {
            logger.info("WhatsApp webhook verified");
            return reply.status(200).send(challenge);
        }

        return reply.status(403).send("Forbidden");
    });

    // POST /webhooks/whatsapp — incoming messages from WhatsApp Cloud API
    fastify.post("/webhooks/whatsapp", async (request, reply) => {
        const bot = channelManager.getPlatformWhatsAppBot();
        if (bot) {
            await bot.handleWebhook(request.body as Record<string, unknown>);
        }
        return reply.status(200).send("OK");
    });
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

        // Handle app_uninstalled event
        if (event.type === "app_uninstalled" || (body.event as Record<string, unknown>)?.type === "tokens_revoked") {
            const platformBot = channelManager.getPlatformSlackBot();
            if (platformBot) {
                await platformBot.removeInstallation(teamId);
            }
            return reply.status(200).send({ ok: true });
        }

        try {
            // First, check for per-workspace channel connections
            const connections = await channelRepository.findActiveConnections();
            const connection = connections.find((c) => {
                const config = c.config as Record<string, unknown>;
                return c.channelType === "slack" && config.teamId === teamId;
            });

            if (connection) {
                // Per-workspace connection takes priority
                const slackAdapter = channelManager.getSlackAdapter();
                await slackAdapter.handleEvent(connection.id, event);
            } else {
                // Fallback to platform Slack bot
                const platformBot = channelManager.getPlatformSlackBot();
                if (platformBot && platformBot.hasTeam(teamId)) {
                    await platformBot.handleEvent(teamId, event);
                }
            }
        } catch (error) {
            logger.error({ teamId, error }, "Slack webhook error");
        }

        return reply.status(200).send({ ok: true });
    });

    // POST /webhooks/email — Cloudflare Email Routing catch-all webhook
    // Cloudflare is configured with a single catch-all rule: *@pushable.ai → this endpoint.
    // We verify the recipient address exists in our DB. If not, we reject with 404
    // so Cloudflare knows the address is invalid (and can bounce the sender).
    fastify.post("/webhooks/email", async (request, reply) => {
        // Optional shared secret verification
        const secret = request.headers["x-email-webhook-secret"] as string;
        if (
            process.env.EMAIL_WEBHOOK_SECRET &&
            secret !== process.env.EMAIL_WEBHOOK_SECRET
        ) {
            return reply.status(403).send({ error: "Forbidden" });
        }

        const body = request.body as Record<string, unknown>;

        // Extract recipient address from Cloudflare payload
        const toRaw = (body.to as string) || "";
        const toAddress = toRaw.includes("<")
            ? (toRaw.match(/<([^>]+)>/)?.[1] ?? toRaw).trim().toLowerCase()
            : toRaw.trim().toLowerCase();

        if (!toAddress) {
            logger.warn({ body }, "Email webhook: missing 'to' address");
            return reply.status(400).send({ error: "Missing recipient address" });
        }

        // Verify recipient workspace exists in DB
        const emailConfig = await emailWorkspaceAddressRepository.findByAddress(toAddress);

        if (!emailConfig) {
            // Address not found — reject so Cloudflare can bounce back to sender
            logger.info({ to: toAddress }, "Email webhook: no workspace found for address, rejecting");
            return reply.status(404).send({ error: `No workspace found for ${toAddress}` });
        }

        if (!emailConfig.enabled) {
            logger.info({ to: toAddress }, "Email webhook: address is disabled, rejecting");
            return reply.status(404).send({ error: `Email address ${toAddress} is disabled` });
        }

        const handler = channelManager.getPlatformEmailHandler();
        if (!handler) {
            return reply.status(503).send({ error: "Email channel not configured" });
        }

        // Address verified — fire-and-forget processing, return 200 immediately
        handler
            .handleInboundEmail(body)
            .catch((err) => logger.error({ err }, "Email webhook processing failed"));

        return reply.status(200).send({ ok: true });
    });

    // POST /webhooks/slack/interactive — handle HITL approval buttons
    fastify.post("/webhooks/slack/interactive", async (request, reply) => {
        try {
            // Slack sends interactive payloads as application/x-www-form-urlencoded
            // with a `payload` field containing JSON
            let payload: Record<string, unknown>;

            const body = request.body as Record<string, unknown>;
            if (typeof body.payload === "string") {
                payload = JSON.parse(body.payload);
            } else if (body.payload && typeof body.payload === "object") {
                payload = body.payload as Record<string, unknown>;
            } else {
                payload = body;
            }

            const platformBot = channelManager.getPlatformSlackBot();
            if (platformBot) {
                await platformBot.handleInteraction(payload);
            }
        } catch (error) {
            logger.error({ error }, "Slack interactive webhook error");
        }

        return reply.status(200).send({ ok: true });
    });
}
