import { integrationRepository } from "../repositories/integration.repository.ts";
import { getComposioClient } from "../lib/composio.ts";
import { NotFoundError, AppError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export const integrationService = {
    async listToolkits(options?: {
        search?: string;
        cursor?: string;
        limit?: number;
    }) {
        const composio = getComposioClient();
        const limit = options?.limit || 20;

        try {
            const session = await composio.create("default");

            const params: Record<string, unknown> = { limit };
            if (options?.cursor) params.nextCursor = options.cursor;

            const result = await session.toolkits(params);
            let items = result.items || [];

            if (options?.search) {
                const q = options.search.toLowerCase();
                items = items.filter(
                    (t: Record<string, unknown>) =>
                        (t.name as string || "").toLowerCase().includes(q) ||
                        (t.slug as string || "").toLowerCase().includes(q)
                );
            }

            const mapped = items.map((t: Record<string, unknown>) => ({
                slug: t.slug,
                name: t.name,
                description: (t as Record<string, unknown>).description || "",
                logo: t.logo || "",
                isConnected: !!(t.connection as Record<string, unknown>)?.connectedAccount,
            }));

            return {
                items: mapped,
                nextCursor: (result as Record<string, unknown>).nextCursor as string | null,
            };
        } catch (error) {
            logger.error({ error }, "Failed to fetch Composio toolkits");
            return { items: [], nextCursor: null };
        }
    },

    async initiateConnection(data: {
        workspaceId: string;
        toolkitSlug: string;
        name: string;
        connectionLabel: string;
        connectionDescription?: string;
        logo?: string;
        redirectUrl: string;
    }) {
        // Validate label uniqueness within workspace
        const existing = await integrationRepository.findByLabelInWorkspace(
            data.connectionLabel,
            data.workspaceId
        );
        if (existing) {
            throw new AppError(
                `A connection named '${data.connectionLabel}' already exists.`,
                400,
                "DUPLICATE_CONNECTION_LABEL"
            );
        }

        const composio = getComposioClient();

        // Create pending integration in DB with logo in metadata
        const integration = await integrationRepository.create({
            workspaceId: data.workspaceId,
            composioToolkitSlug: data.toolkitSlug,
            composioConnectionId: "pending",
            name: data.name,
            connectionLabel: data.connectionLabel,
            connectionDescription: data.connectionDescription,
            connectionIcon: data.logo,
            status: "pending",
            metadata: data.logo ? { logo: data.logo } : {},
        });

        try {
            // Create a session for this workspace and authorize the toolkit
            const session = await composio.create(data.workspaceId);
            const connectionRequest = await session.authorize(
                data.toolkitSlug,
                {
                    callbackUrl: data.redirectUrl,
                }
            );

            // Update the integration with the connection request info
            const redirectUrl = connectionRequest.redirectUrl;
            const connectionId =
                (connectionRequest as unknown as Record<string, unknown>).id as string ||
                integration.id;

            await integrationRepository.updateStatus(
                integration.id,
                "pending",
                connectionId
            );

            return {
                connectionUrl: redirectUrl,
                integrationId: integration.id,
            };
        } catch (error) {
            logger.error(
                { error, toolkitSlug: data.toolkitSlug },
                "Failed to initiate Composio connection"
            );
            await integrationRepository.updateStatus(
                integration.id,
                "failed"
            );
            throw error;
        }
    },

    async pollConnectionStatus(integrationId: string, workspaceId: string) {
        const integration = await integrationRepository.findById(
            integrationId,
            workspaceId
        );
        if (!integration) throw new NotFoundError("Integration not found");

        if (integration.status === "active") {
            return { status: "active" as const };
        }

        try {
            const composio = getComposioClient();

            // Check connection status via connected accounts list
            const accounts = await composio.connectedAccounts.list({
                userIds: [workspaceId],
                toolkitSlugs: [integration.composioToolkitSlug],
            });

            const activeAccount = (accounts.items || []).find(
                (a: Record<string, unknown>) => a.status === "ACTIVE"
            );

            if (activeAccount) {
                await integrationRepository.updateStatus(
                    integrationId,
                    "active",
                    activeAccount.id as string
                );
                return { status: "active" as const };
            }

            return { status: integration.status };
        } catch (error) {
            logger.warn(
                { error, integrationId },
                "Failed to poll Composio connection status"
            );
            return { status: integration.status };
        }
    },

    async handleCallback(
        workspaceId: string,
        connectedAccountId: string,
        status: string
    ) {
        if (status !== "success") {
            // Find the most recent pending integration for this workspace and mark failed
            const all = await integrationRepository.findByWorkspace(workspaceId);
            const pending = all.find((i) => i.status === "pending");
            if (pending) {
                await integrationRepository.updateStatus(pending.id, "failed");
            }
            return { status: "failed" as const };
        }

        // Find pending integration for this workspace and link it
        const all = await integrationRepository.findByWorkspace(workspaceId);
        const pending = all.find((i) => i.status === "pending");

        if (pending) {
            await integrationRepository.updateStatus(
                pending.id,
                "active",
                connectedAccountId
            );
            return { status: "active" as const, integrationId: pending.id };
        }

        // No pending integration found — still try to mark based on connected account
        logger.warn(
            { workspaceId, connectedAccountId },
            "No pending integration found for callback"
        );
        return { status: "active" as const };
    },

    async getIntegrations(workspaceId: string) {
        return integrationRepository.findByWorkspace(workspaceId);
    },

    async deleteIntegration(id: string, workspaceId: string) {
        const integration = await integrationRepository.findById(
            id,
            workspaceId
        );
        if (!integration) throw new NotFoundError("Integration not found");

        // Try to delete from Composio
        if (
            integration.composioConnectionId &&
            integration.composioConnectionId !== "pending"
        ) {
            try {
                const composio = getComposioClient();
                await composio.connectedAccounts.delete(
                    integration.composioConnectionId
                );
            } catch (error) {
                logger.warn(
                    { error, id },
                    "Failed to delete Composio connected account, proceeding with DB delete"
                );
            }
        }

        await integrationRepository.delete(id, workspaceId);
    },

    async updateConnection(
        id: string,
        workspaceId: string,
        data: {
            connectionLabel?: string;
            connectionDescription?: string;
        }
    ) {
        const integration = await integrationRepository.findById(id, workspaceId);
        if (!integration) throw new NotFoundError("Integration not found");

        // If label is changing, check uniqueness
        if (data.connectionLabel && data.connectionLabel !== integration.connectionLabel) {
            const existing = await integrationRepository.findByLabelInWorkspace(
                data.connectionLabel,
                workspaceId
            );
            if (existing) {
                throw new AppError(
                    `A connection named '${data.connectionLabel}' already exists.`,
                    400,
                    "DUPLICATE_CONNECTION_LABEL"
                );
            }
        }

        return integrationRepository.updateConnection(id, workspaceId, data);
    },

    async assignToAgent(
        agentId: string,
        integrationId: string,
        workspaceId: string
    ) {
        return integrationRepository.assignToAgent(
            agentId,
            integrationId,
            workspaceId
        );
    },

    async removeFromAgent(
        agentId: string,
        integrationId: string,
        workspaceId: string
    ) {
        return integrationRepository.removeFromAgent(
            agentId,
            integrationId,
            workspaceId
        );
    },

    async getAgentIntegrations(agentId: string, workspaceId: string) {
        return integrationRepository.findByAgent(agentId, workspaceId);
    },
};
