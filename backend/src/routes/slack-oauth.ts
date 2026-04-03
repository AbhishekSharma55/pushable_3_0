import type { FastifyInstance } from "fastify";
import { slackInstallationRepository } from "../repositories/slack-installation.repository.ts";
import { platformBotConfigRepository } from "../repositories/platform-bot-config.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { logger } from "../lib/logger.ts";

async function getSlackCredentials(): Promise<{ clientId?: string; clientSecret?: string }> {
    try {
        const dbConfig = await platformBotConfigRepository.findByPlatform("slack");
        const cfg = dbConfig?.config as { clientId?: string; clientSecret?: string } | undefined;
        if (cfg?.clientId && cfg?.clientSecret) return cfg;
    } catch { /* ignore */ }
    return { clientId: process.env.SLACK_CLIENT_ID, clientSecret: process.env.SLACK_CLIENT_SECRET };
}

export async function slackOAuthRoutes(fastify: FastifyInstance) {
    // GET /slack/oauth/install — redirect to Slack OAuth authorization page
    fastify.get("/slack/oauth/install", async (_request, reply) => {
        const { clientId } = await getSlackCredentials();
        if (!clientId) {
            return reply.status(503).send({ error: "Slack integration not configured" });
        }

        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
        const redirectUri = `${baseUrl}/slack/oauth/callback`;
        const scopes = "chat:write,im:read,im:history,users:read";

        const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

        return reply.redirect(slackUrl);
    });

    // GET /slack/oauth/callback — handle OAuth callback from Slack
    fastify.get("/slack/oauth/callback", async (request, reply) => {
        const { code, error: slackError } = request.query as { code?: string; error?: string };

        if (slackError) {
            logger.warn({ slackError }, "Slack OAuth denied by user");
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            return reply.redirect(`${frontendUrl}/channels?slack_error=${encodeURIComponent(slackError)}`);
        }

        if (!code) {
            return reply.status(400).send({ error: "Missing authorization code" });
        }

        const { clientId, clientSecret } = await getSlackCredentials();
        if (!clientId || !clientSecret) {
            return reply.status(503).send({ error: "Slack integration not configured" });
        }

        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
        const redirectUri = `${baseUrl}/slack/oauth/callback`;

        try {
            // Exchange code for token
            const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                    redirect_uri: redirectUri,
                }),
            });

            const tokenData = await tokenResponse.json() as {
                ok: boolean;
                error?: string;
                access_token?: string;
                token_type?: string;
                scope?: string;
                bot_user_id?: string;
                team?: { id: string; name: string };
                enterprise?: { id: string; name: string } | null;
                is_enterprise_install?: boolean;
                authed_user?: { id: string };
            };

            if (!tokenData.ok) {
                logger.error({ error: tokenData.error }, "Slack OAuth token exchange failed");
                const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
                return reply.redirect(`${frontendUrl}/channels?slack_error=${encodeURIComponent(tokenData.error || "token_exchange_failed")}`);
            }

            const teamId = tokenData.team?.id;
            const teamName = tokenData.team?.name;
            const botToken = tokenData.access_token;

            if (!teamId || !botToken) {
                return reply.status(500).send({ error: "Invalid response from Slack" });
            }

            // Store installation
            await slackInstallationRepository.upsert({
                slackTeamId: teamId,
                slackTeamName: teamName,
                botToken,
                botUserId: tokenData.bot_user_id,
                installedBySlackUserId: tokenData.authed_user?.id,
                scope: tokenData.scope,
                isEnterpriseInstall: tokenData.is_enterprise_install || false,
                enterpriseId: tokenData.enterprise?.id,
                enterpriseName: tokenData.enterprise?.name,
            });

            // Add to live platform bot
            const platformBot = channelManager.getPlatformSlackBot();
            if (platformBot) {
                await platformBot.addInstallation(teamId, botToken, tokenData.bot_user_id);
            }

            logger.info({ teamId, teamName }, "Slack app installed successfully");

            // Redirect to frontend success page
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            return reply.redirect(`${frontendUrl}/channels?slack_installed=true&team=${encodeURIComponent(teamName || teamId)}`);
        } catch (error) {
            logger.error({ error: error instanceof Error ? error.message : error }, "Slack OAuth callback error");
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            return reply.redirect(`${frontendUrl}/channels?slack_error=internal_error`);
        }
    });
}
