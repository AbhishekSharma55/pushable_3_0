import { WebClient } from "@slack/web-api";
import { logger } from "../lib/logger.ts";
import type {
    ChannelAdapter,
    ChannelConnection,
    NormalizedMessage,
    NormalizedResponse,
} from "./types.ts";

let onMessage: ((msg: NormalizedMessage) => Promise<void>) | null = null;

export function setSlackMessageHandler(
    handler: (msg: NormalizedMessage) => Promise<void>
) {
    onMessage = handler;
}

interface SlackCredentials {
    botToken?: string;
    signingSecret?: string;
}

export class SlackAdapter implements ChannelAdapter {
    channelType = "slack" as const;
    private clients = new Map<string, { client: WebClient; connection: ChannelConnection }>();

    async initialize(connection: ChannelConnection): Promise<void> {
        const creds = connection.credentials as SlackCredentials;
        if (!creds.botToken) throw new Error("Missing botToken in Slack credentials");

        const client = new WebClient(creds.botToken);

        this.clients.set(connection.id, { client, connection });

        try {
            const authResult = await client.auth.test();
            logger.info(
                { connectionId: connection.id, team: authResult.team, botUser: authResult.user_id },
                "Slack adapter initialized"
            );
        } catch (error) {
            logger.warn({ connectionId: connection.id, error }, "Could not verify Slack auth");
        }
    }

    async shutdown(connectionId: string): Promise<void> {
        this.clients.delete(connectionId);
        logger.info({ connectionId }, "Slack adapter stopped");
    }

    async sendMessage(
        connectionId: string,
        response: NormalizedResponse
    ): Promise<void> {
        const entry = this.clients.get(connectionId);
        if (!entry || !response.threadId) return;

        await entry.client.chat.postMessage({
            channel: response.threadId,
            text: response.text,
            thread_ts: response.messageId,
        });
    }

    async handleEvent(connectionId: string, event: Record<string, unknown>): Promise<void> {
        const entry = this.clients.get(connectionId);
        if (!entry || !onMessage) return;

        const eventType = event.type as string;
        const { connection, client } = entry;

        // Skip bot's own messages
        if (event.bot_id) return;

        const isAppMention = eventType === "app_mention";
        const isDM = eventType === "message" && event.channel_type === "im";

        if (!isAppMention && !isDM) return;

        let text = (event.text as string) || "";
        if (isAppMention) {
            text = text.replace(/<@[A-Z0-9]+>/gi, "").trim();
        }

        if (!text) return;

        const userId = event.user as string;
        let username = userId;
        try {
            const userInfo = await client.users.info({ user: userId });
            username = userInfo.user?.profile?.display_name ||
                userInfo.user?.real_name || userId;
        } catch {}

        const channel = event.channel as string;
        const ts = event.ts as string;
        const threadTs = (event.thread_ts as string) || ts;

        const message: NormalizedMessage = {
            connectionId: connection.id,
            channelType: "slack",
            workspaceId: connection.workspaceId,
            agentId: connection.agentId,
            externalUserId: userId,
            externalUsername: username,
            text,
            threadId: channel,
            messageId: threadTs,
            raw: event,
        };

        // Add reaction as typing indicator
        try {
            await client.reactions.add({
                channel,
                timestamp: ts,
                name: "hourglass_flowing_sand",
            });
        } catch {}

        await onMessage(message);

        // Remove typing indicator
        try {
            await client.reactions.remove({
                channel,
                timestamp: ts,
                name: "hourglass_flowing_sand",
            });
        } catch {}
    }

    getClient(connectionId: string) {
        return this.clients.get(connectionId);
    }
}
