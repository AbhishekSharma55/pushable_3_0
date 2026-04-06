import { WebClient } from "@slack/web-api";
import { channelRepository } from "../repositories/channel.repository.ts";
import { slackInstallationRepository } from "../repositories/slack-installation.repository.ts";
import { TelegramAdapter, setTelegramMessageHandler, setTelegramApprovalHandler } from "./telegram.channel.ts";
import { SlackAdapter, setSlackMessageHandler } from "./slack.channel.ts";
import { PlatformTelegramBot } from "./platform-telegram.ts";
import { PlatformSlackBot } from "./platform-slack.ts";
import { PlatformWhatsAppBot } from "./platform-whatsapp.ts";
import { routeMessage, setResponseSender, setApprovalSender, resolveChannelApproval } from "./message-router.ts";
import { platformBotConfigRepository } from "../repositories/platform-bot-config.repository.ts";
import { logger } from "../lib/logger.ts";
import type {
    ChannelAdapter,
    ChannelConnection,
    NormalizedResponse,
} from "./types.ts";

const PLATFORM_TELEGRAM_CONNECTION_ID = "platform-telegram";
const PLATFORM_SLACK_CONNECTION_ID = "platform-slack";
const PLATFORM_WHATSAPP_CONNECTION_ID = "platform-whatsapp";

class ChannelManager {
    private adapters = new Map<
        string,
        { adapter: ChannelAdapter; connection: ChannelConnection }
    >();
    private telegramAdapter = new TelegramAdapter();
    private slackAdapter = new SlackAdapter();
    private platformTelegramBot: PlatformTelegramBot | null = null;
    private platformSlackBot: PlatformSlackBot | null = null;
    private platformWhatsAppBot: PlatformWhatsAppBot | null = null;
    private initialized = false;

    private setupHandlers() {
        if (this.initialized) return;
        setTelegramMessageHandler(routeMessage);
        setSlackMessageHandler(routeMessage);
        setResponseSender((connectionId, response) =>
            this.sendMessage(connectionId, response)
        );
        // Wire HITL approval flow for Telegram + Slack (per-workspace + platform)
        setApprovalSender((connectionId, chatId, text, sessionId) => {
            if (connectionId === PLATFORM_TELEGRAM_CONNECTION_ID && this.platformTelegramBot) {
                return this.platformTelegramBot.sendApprovalMessage(chatId, text, sessionId);
            }
            if (connectionId === PLATFORM_SLACK_CONNECTION_ID && this.platformSlackBot) {
                return this.platformSlackBot.sendApprovalMessage(chatId, text, sessionId);
            }
            if (connectionId === PLATFORM_WHATSAPP_CONNECTION_ID && this.platformWhatsAppBot) {
                return this.platformWhatsAppBot.sendApprovalMessage(chatId, text, sessionId);
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
        // Route to platform bots if applicable
        if (connectionId === PLATFORM_TELEGRAM_CONNECTION_ID && this.platformTelegramBot) {
            await this.platformTelegramBot.sendResponse(response);
            return;
        }
        if (connectionId === PLATFORM_SLACK_CONNECTION_ID && this.platformSlackBot) {
            await this.platformSlackBot.sendResponse(response);
            return;
        }
        if (connectionId === PLATFORM_WHATSAPP_CONNECTION_ID && this.platformWhatsAppBot) {
            await this.platformWhatsAppBot.sendResponse(response);
            return;
        }

        const entry = this.adapters.get(connectionId);
        if (!entry) return;
        await entry.adapter.sendMessage(connectionId, response);
    }

    async initializePlatformTelegram(): Promise<void> {
        // DB-first: check platform_bot_configs, fall back to env var
        let token: string | undefined;
        try {
            const dbConfig = await platformBotConfigRepository.findByPlatform("telegram");
            const dbToken = (dbConfig?.config as { botToken?: string })?.botToken;
            if (dbToken) {
                token = dbToken;
                logger.info("Using Telegram bot token from database config");
            }
        } catch (err) {
            logger.warn({ error: err instanceof Error ? err.message : err }, "Failed to read Telegram config from DB, falling back to env");
        }

        if (!token) {
            token = process.env.TELEGRAM_BOT_TOKEN;
        }

        if (!token) {
            logger.info("No TELEGRAM_BOT_TOKEN set — platform Telegram bot disabled");
            return;
        }

        this.setupHandlers();

        try {
            this.platformTelegramBot = new PlatformTelegramBot(token);
            await this.platformTelegramBot.start();

            // Cache bot info and update status in DB
            try {
                const botUsername = this.platformTelegramBot.getBotUsername?.();
                await platformBotConfigRepository.upsert({
                    platform: "telegram",
                    config: { botToken: token },
                    botUsername: botUsername ?? null,
                });
                await platformBotConfigRepository.updateStatus("telegram", "active");
            } catch { /* non-critical */ }

            logger.info("Platform Telegram bot initialized");
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errMsg }, "Failed to initialize platform Telegram bot");

            try {
                await platformBotConfigRepository.updateStatus("telegram", "error", errMsg);
            } catch { /* non-critical */ }

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

    async initializePlatformSlack(): Promise<void> {
        // DB-first: check platform_bot_configs, fall back to env vars
        let clientId: string | undefined;
        let clientSecret: string | undefined;
        let signingSecret: string | undefined;
        let directToken: string | undefined;

        try {
            const dbConfig = await platformBotConfigRepository.findByPlatform("slack");
            const cfg = dbConfig?.config as {
                clientId?: string;
                clientSecret?: string;
                signingSecret?: string;
                botToken?: string;
            } | undefined;

            if (cfg?.clientId && cfg?.clientSecret && cfg?.signingSecret) {
                clientId = cfg.clientId;
                clientSecret = cfg.clientSecret;
                signingSecret = cfg.signingSecret;
                directToken = cfg.botToken;
                logger.info("Using Slack config from database");
            }
        } catch (err) {
            logger.warn({ error: err instanceof Error ? err.message : err }, "Failed to read Slack config from DB, falling back to env");
        }

        if (!clientId || !clientSecret || !signingSecret) {
            clientId = process.env.SLACK_CLIENT_ID;
            clientSecret = process.env.SLACK_CLIENT_SECRET;
            signingSecret = process.env.SLACK_SIGNING_SECRET;
            directToken = directToken || process.env.SLACK_BOT_TOKEN;
        }

        if (!clientId || !clientSecret || !signingSecret) {
            logger.info("No SLACK_CLIENT_ID/SECRET/SIGNING_SECRET set — platform Slack bot disabled");
            return;
        }

        this.setupHandlers();

        try {
            this.platformSlackBot = new PlatformSlackBot(signingSecret);

            // If bot token available, auto-register the installation
            if (directToken) {
                try {
                    const client = new WebClient(directToken);
                    const authResult = await client.auth.test();
                    const teamId = authResult.team_id as string;
                    const teamName = authResult.team as string;

                    await slackInstallationRepository.upsert({
                        slackTeamId: teamId,
                        slackTeamName: teamName,
                        botToken: directToken,
                        botUserId: authResult.user_id as string,
                        botId: authResult.bot_id as string | undefined,
                    });

                    logger.info({ teamId, teamName }, "Auto-registered Slack installation");

                    // Cache bot info in platform config
                    try {
                        await platformBotConfigRepository.upsert({
                            platform: "slack",
                            config: { clientId, clientSecret, signingSecret, botToken: directToken },
                            botName: teamName,
                            botUsername: authResult.user as string | undefined,
                        });
                    } catch { /* non-critical */ }
                } catch (tokenError) {
                    logger.error(
                        { error: tokenError instanceof Error ? tokenError.message : tokenError },
                        "Failed to auto-register Slack bot token"
                    );
                }
            }

            await this.platformSlackBot.loadInstallations();

            try {
                await platformBotConfigRepository.updateStatus("slack", "active");
            } catch { /* non-critical */ }

            logger.info("Platform Slack bot initialized");
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errMsg }, "Failed to initialize platform Slack bot");

            try {
                await platformBotConfigRepository.updateStatus("slack", "error", errMsg);
            } catch { /* non-critical */ }

            this.platformSlackBot = null;
        }
    }

    async shutdownPlatformSlack(): Promise<void> {
        this.platformSlackBot = null;
    }

    getPlatformSlackBot(): PlatformSlackBot | null {
        return this.platformSlackBot;
    }

    async initializePlatformWhatsApp(): Promise<void> {
        // DB-first: check platform_bot_configs, fall back to env vars
        let phoneNumberId: string | undefined;
        let accessToken: string | undefined;
        let appSecret: string | undefined;
        let webhookVerifyToken: string | undefined;

        try {
            const dbConfig = await platformBotConfigRepository.findByPlatform("whatsapp");
            const cfg = dbConfig?.config as {
                phoneNumberId?: string;
                accessToken?: string;
                appSecret?: string;
                webhookVerifyToken?: string;
            } | undefined;

            if (cfg?.phoneNumberId && cfg?.accessToken) {
                phoneNumberId = cfg.phoneNumberId;
                accessToken = cfg.accessToken;
                appSecret = cfg.appSecret;
                webhookVerifyToken = cfg.webhookVerifyToken;
                logger.info("Using WhatsApp config from database");
            }
        } catch (err) {
            logger.warn({ error: err instanceof Error ? err.message : err }, "Failed to read WhatsApp config from DB, falling back to env");
        }

        if (!phoneNumberId || !accessToken) {
            phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
            accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
            appSecret = appSecret || process.env.WHATSAPP_APP_SECRET;
            webhookVerifyToken = webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        }

        if (!phoneNumberId || !accessToken) {
            logger.info("No WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN set — platform WhatsApp bot disabled");
            return;
        }

        this.setupHandlers();

        try {
            this.platformWhatsAppBot = new PlatformWhatsAppBot({
                phoneNumberId,
                accessToken,
                appSecret: appSecret || "",
                webhookVerifyToken: webhookVerifyToken || "pushable_whatsapp_verify",
            });

            // Cache config and update status in DB
            try {
                await platformBotConfigRepository.upsert({
                    platform: "whatsapp",
                    config: { phoneNumberId, accessToken, appSecret, webhookVerifyToken },
                    botName: "WhatsApp Business",
                });
                await platformBotConfigRepository.updateStatus("whatsapp", "active");
            } catch { /* non-critical */ }

            logger.info("Platform WhatsApp bot initialized");
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error({ error: errMsg }, "Failed to initialize platform WhatsApp bot");

            try {
                await platformBotConfigRepository.updateStatus("whatsapp", "error", errMsg);
            } catch { /* non-critical */ }

            this.platformWhatsAppBot = null;
        }
    }

    async shutdownPlatformWhatsApp(): Promise<void> {
        this.platformWhatsAppBot = null;
    }

    getPlatformWhatsAppBot(): PlatformWhatsAppBot | null {
        return this.platformWhatsAppBot;
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
