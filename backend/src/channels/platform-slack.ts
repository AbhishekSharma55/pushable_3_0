import { WebClient } from "@slack/web-api";
import { logger } from "../lib/logger.ts";
import { slackLinkRepository } from "../repositories/slack-link.repository.ts";
import { slackInstallationRepository } from "../repositories/slack-installation.repository.ts";
import { ceoService } from "../services/ceo.service.ts";
import { validateAndConsume } from "../lib/slack-verification.ts";
import { routeMessage, resolveChannelApproval } from "./message-router.ts";
import type { NormalizedMessage, NormalizedResponse } from "./types.ts";

const PLATFORM_CONNECTION_ID = "platform-slack";
const VERIFICATION_CODE_PATTERN = /^[A-Fa-f0-9]{6}$/;

export class PlatformSlackBot {
    private clients = new Map<string, WebClient>(); // teamId → WebClient
    private botUserIds = new Map<string, string>(); // teamId → bot user ID
    private signingSecret: string;

    constructor(signingSecret: string) {
        this.signingSecret = signingSecret;
    }

    /** Load all installations from DB and create WebClients */
    async loadInstallations(): Promise<void> {
        const installations = await slackInstallationRepository.findAll();
        let loaded = 0;

        for (const install of installations) {
            try {
                const client = new WebClient(install.botToken);
                const authResult = await client.auth.test();

                this.clients.set(install.slackTeamId, client);
                if (authResult.user_id) {
                    this.botUserIds.set(install.slackTeamId, authResult.user_id);
                }

                loaded++;
            } catch (error) {
                logger.error(
                    { teamId: install.slackTeamId, error: error instanceof Error ? error.message : error },
                    "Failed to load Slack installation"
                );
            }
        }

        logger.info({ count: loaded, total: installations.length }, "Loaded Slack installations");
    }

    /** Add a new installation (called after OAuth callback) */
    async addInstallation(teamId: string, botToken: string, botUserId?: string): Promise<void> {
        const client = new WebClient(botToken);
        this.clients.set(teamId, client);
        if (botUserId) {
            this.botUserIds.set(teamId, botUserId);
        }
        logger.info({ teamId }, "Added Slack installation to platform bot");
    }

    /** Remove an installation (called on app_uninstalled event) */
    async removeInstallation(teamId: string): Promise<void> {
        this.clients.delete(teamId);
        this.botUserIds.delete(teamId);

        // Clean up DB
        await slackInstallationRepository.deleteByTeamId(teamId);
        await slackLinkRepository.deleteByTeamId(teamId);

        logger.info({ teamId }, "Removed Slack installation from platform bot");
    }

    /** Handle incoming Slack event */
    async handleEvent(teamId: string, event: Record<string, unknown>): Promise<void> {
        const client = this.clients.get(teamId);
        if (!client) {
            logger.warn({ teamId }, "No Slack client for team");
            return;
        }

        // Skip bot's own messages
        const botUserId = this.botUserIds.get(teamId);
        if (event.bot_id || (botUserId && event.user === botUserId)) {
            return;
        }

        // Only handle DMs
        if (event.type !== "message" || event.channel_type !== "im") {
            return;
        }

        // Skip message subtypes (edits, deletes, etc.) — only handle plain messages
        if (event.subtype) {
            return;
        }

        const slackUserId = event.user as string;
        const channelId = event.channel as string;
        const text = (event.text as string || "").trim();
        const messageTs = event.ts as string;

        if (!text || !slackUserId || !channelId) return;

        // Check if it's a verification code
        if (VERIFICATION_CODE_PATTERN.test(text)) {
            const result = validateAndConsume(text);
            if (result) {
                try {
                    // Fetch user info for display name
                    let username: string | undefined;
                    let displayName: string | undefined;
                    try {
                        const userInfo = await client.users.info({ user: slackUserId });
                        username = userInfo.user?.name;
                        displayName = userInfo.user?.profile?.display_name || userInfo.user?.real_name;
                    } catch {
                        // Non-critical — proceed without user info
                    }

                    await slackLinkRepository.create({
                        slackUserId,
                        slackTeamId: teamId,
                        slackUsername: username,
                        slackDisplayName: displayName,
                        slackDmChannelId: channelId,
                        workspaceId: result.workspaceId,
                        userId: result.userId,
                    });

                    await client.chat.postMessage({
                        channel: channelId,
                        text: "Successfully linked! You can now send me messages and your CEO agent will respond.",
                    });
                    return;
                } catch (error: unknown) {
                    const msg = error instanceof Error ? error.message : String(error);
                    if (msg.includes("unique") || msg.includes("duplicate")) {
                        await client.chat.postMessage({
                            channel: channelId,
                            text: "This Slack account is already linked to a workspace. " +
                                "Please unlink it from your dashboard first before linking to a new workspace.",
                        });
                    } else {
                        logger.error({ error, slackUserId, teamId }, "Failed to create slack link");
                        await client.chat.postMessage({
                            channel: channelId,
                            text: "Something went wrong linking your account. Please try again.",
                        });
                    }
                    return;
                }
            }
            // Code didn't match — fall through to regular message handling
        }

        // Look up the user's workspace link
        const link = await slackLinkRepository.findBySlackIdentity(teamId, slackUserId);
        if (!link) {
            await client.chat.postMessage({
                channel: channelId,
                text: "You haven't linked your Slack account yet.\n\n" +
                    "Go to your Pushable dashboard → Channels → Slack and click \"Connect Slack\" to get a verification code.",
            });
            return;
        }

        // Update DM channel info (fire-and-forget)
        slackLinkRepository
            .updateDmChannelInfo(teamId, slackUserId, channelId)
            .catch((err) => logger.warn({ err }, "Failed to update Slack DM channel info"));

        // Update last message time (fire-and-forget)
        slackLinkRepository
            .updateLastMessageAt(teamId, slackUserId)
            .catch((err) => logger.warn({ err }, "Failed to update Slack last message time"));

        // Get the CEO agent for this workspace
        let ceo;
        try {
            ceo = await ceoService.getOrCreateCEO(link.workspaceId);
        } catch (error) {
            logger.error({ error, workspaceId: link.workspaceId }, "Failed to get CEO agent");
            await client.chat.postMessage({
                channel: channelId,
                text: "Something went wrong. Please try again later.",
            });
            return;
        }

        // Add typing indicator
        try {
            await client.reactions.add({
                channel: channelId,
                timestamp: messageTs,
                name: "hourglass_flowing_sand",
            });
        } catch {
            // Non-critical
        }

        // Build normalized message and route to agent
        const message: NormalizedMessage = {
            connectionId: PLATFORM_CONNECTION_ID,
            channelType: "slack",
            workspaceId: link.workspaceId,
            agentId: ceo.id,
            platformUserId: link.userId || undefined,
            externalUserId: slackUserId,
            externalUsername: link.slackUsername || link.slackDisplayName || slackUserId,
            text,
            threadId: `${teamId}:${channelId}`,
            messageId: messageTs,
            raw: event,
        };

        try {
            await routeMessage(message);
        } finally {
            // Remove typing indicator
            try {
                await client.reactions.remove({
                    channel: channelId,
                    timestamp: messageTs,
                    name: "hourglass_flowing_sand",
                });
            } catch {
                // Non-critical
            }
        }
    }

    /** Handle interactive component payloads (HITL approval buttons) */
    async handleInteraction(payload: Record<string, unknown>): Promise<void> {
        const actions = payload.actions as Array<Record<string, unknown>> | undefined;
        if (!actions || actions.length === 0) return;

        const action = actions[0];
        const actionId = action.action_id as string;
        const sessionId = action.value as string;

        if (!actionId || !sessionId) return;
        if (!actionId.startsWith("hitl_")) return;

        const decision = actionId === "hitl_approve" ? "approve" : "reject";

        // Get team and channel info from the payload
        const team = payload.team as Record<string, unknown> | undefined;
        const channel = payload.channel as Record<string, unknown> | undefined;
        const messagePayload = payload.message as Record<string, unknown> | undefined;
        const teamId = team?.id as string;
        const channelId = channel?.id as string;
        const messageTs = messagePayload?.ts as string;

        // Update the original message to show the decision
        if (teamId && channelId && messageTs) {
            const client = this.clients.get(teamId);
            if (client) {
                const decisionEmoji = decision === "approve" ? "\u2705" : "\u274C";
                const originalText = (messagePayload?.text as string) || "";
                try {
                    await client.chat.update({
                        channel: channelId,
                        ts: messageTs,
                        text: `${originalText}\n\n${decisionEmoji} *${decision === "approve" ? "Approved" : "Rejected"}* by user`,
                        blocks: [], // Remove interactive buttons
                    });
                } catch {
                    // Ignore update errors
                }
            }
        }

        try {
            const result = await resolveChannelApproval(sessionId, decision as "approve" | "reject");
            if (result && result.content && teamId) {
                const [resultTeamId, resultChannelId] = result.threadId.split(":");
                await this.sendMessage(resultTeamId || teamId, resultChannelId || channelId, result.content);
            }
        } catch (error) {
            logger.error({ error, sessionId }, "Failed to resolve platform Slack HITL approval");
            if (teamId && channelId) {
                const client = this.clients.get(teamId);
                if (client) {
                    await client.chat.postMessage({
                        channel: channelId,
                        text: "Something went wrong processing your decision.",
                    }).catch(() => {});
                }
            }
        }
    }

    /** Send a message to a specific Slack channel */
    async sendMessage(teamId: string, channelId: string, text: string): Promise<void> {
        const client = this.clients.get(teamId);
        if (!client) {
            logger.warn({ teamId }, "No Slack client for team when sending message");
            return;
        }

        try {
            await client.chat.postMessage({
                channel: channelId,
                text,
                mrkdwn: true,
            });
        } catch (error) {
            logger.error(
                { teamId, channelId, error: error instanceof Error ? error.message : error },
                "Failed to send Slack message"
            );
        }
    }

    /** Send response back through the channel (threadId is encoded as teamId:channelId) */
    async sendResponse(response: NormalizedResponse): Promise<void> {
        if (!response.threadId) return;

        const colonIdx = response.threadId.indexOf(":");
        if (colonIdx === -1) return;

        const teamId = response.threadId.slice(0, colonIdx);
        const channelId = response.threadId.slice(colonIdx + 1);

        await this.sendMessage(teamId, channelId, response.text);
    }

    /** Send an approval message with interactive buttons */
    async sendApprovalMessage(
        chatId: string,
        text: string,
        sessionId: string
    ): Promise<void> {
        // chatId is encoded as teamId:channelId
        const colonIdx = chatId.indexOf(":");
        if (colonIdx === -1) return;

        const teamId = chatId.slice(0, colonIdx);
        const channelId = chatId.slice(colonIdx + 1);

        const client = this.clients.get(teamId);
        if (!client) return;

        try {
            await client.chat.postMessage({
                channel: channelId,
                text,
                blocks: [
                    {
                        type: "section",
                        text: { type: "mrkdwn", text },
                    },
                    {
                        type: "actions",
                        elements: [
                            {
                                type: "button",
                                text: { type: "plain_text", text: "\u2705 Approve" },
                                style: "primary",
                                action_id: "hitl_approve",
                                value: sessionId,
                            },
                            {
                                type: "button",
                                text: { type: "plain_text", text: "\u274C Reject" },
                                style: "danger",
                                action_id: "hitl_reject",
                                value: sessionId,
                            },
                        ],
                    },
                ],
            });
        } catch (error) {
            logger.error(
                { teamId, channelId, error: error instanceof Error ? error.message : error },
                "Failed to send Slack approval message"
            );
        }
    }

    getConnectionId(): string {
        return PLATFORM_CONNECTION_ID;
    }

    getSigningSecret(): string {
        return this.signingSecret;
    }

    hasTeam(teamId: string): boolean {
        return this.clients.has(teamId);
    }
}
