import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { emailWorkspaceAddressRepository } from "../repositories/email-workspace-address.repository.ts";
import { ceoService } from "./ceo.service.ts";
import { testerService } from "./tester.service.ts";
import { ForbiddenError } from "../lib/errors.ts";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.ts";

function generateEmailAddress(slug: string): string {
    const domain = process.env.EMAIL_DOMAIN || "pushable.ai";
    // Use the slug directly (already has random suffix from generateSlug)
    const prefix = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `${prefix}@${domain}`;
}

function generateSlug(name: string): string {
    const base = name.toLowerCase().replace(/\s+/g, "-");
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${base}-${suffix}`;
}

export const workspaceService = {
    async getWorkspaces(userId: string) {
        return workspaceRepository.findByUserId(userId);
    },

    async createWorkspace(data: { name: string }, userId: string) {
        const slug = generateSlug(data.name);
        const extensionApiKey = randomUUID();

        const workspace = await workspaceRepository.create({
            name: data.name,
            slug,
            ownerId: userId,
            extensionApiKey,
        });

        // Add creator as owner
        await workspaceRepository.addMember({
            workspaceId: workspace.id,
            userId,
            role: "owner",
        });

        // Create credits row
        await workspaceRepository.createCredits(workspace.id);

        // Auto-create CEO and Tester agents
        try {
            await ceoService.getOrCreateCEO(workspace.id);
        } catch (error) {
            logger.warn({ error, workspaceId: workspace.id }, "Failed to auto-create CEO agent for workspace");
        }
        try {
            await testerService.getOrCreateTester(workspace.id);
        } catch (error) {
            logger.warn({ error, workspaceId: workspace.id }, "Failed to auto-create Tester agent for workspace");
        }

        // Auto-generate workspace email address
        try {
            const emailAddress = generateEmailAddress(slug);
            await emailWorkspaceAddressRepository.create({
                workspaceId: workspace.id,
                address: emailAddress,
                displayName: data.name,
            });
            logger.info({ workspaceId: workspace.id, emailAddress }, "Auto-generated workspace email address");
        } catch (error) {
            logger.warn({ error, workspaceId: workspace.id }, "Failed to auto-generate email address for workspace");
        }

        return workspace;
    },

    async getWorkspaceById(id: string, userId: string) {
        const isMember = await workspaceRepository.isMember(id, userId);
        if (!isMember) {
            throw new ForbiddenError("You are not a member of this workspace");
        }

        return workspaceRepository.findById(id);
    },

    async getExtensionSettings(workspaceId: string, userId: string) {
        const isMember = await workspaceRepository.isMember(workspaceId, userId);
        if (!isMember) {
            throw new ForbiddenError("You are not a member of this workspace");
        }

        let workspace = await workspaceRepository.findById(workspaceId);
        if (!workspace) throw new ForbiddenError("Workspace not found");

        // Auto-generate an API key on first access if none exists
        if (!workspace.extensionApiKey) {
            workspace = await workspaceRepository.updateExtensionApiKey(
                workspaceId,
                randomUUID()
            );
        }

        const bridgeHost = process.env.EXTENSION_BRIDGE_PUBLIC_URL || `wss://ws.pushable.ai`;

        return {
            wsUrl: bridgeHost,
            apiKey: workspace?.extensionApiKey ?? "",
        };
    },

    async regenerateExtensionApiKey(workspaceId: string, userId: string) {
        const isMember = await workspaceRepository.isMember(workspaceId, userId);
        if (!isMember) {
            throw new ForbiddenError("You are not a member of this workspace");
        }

        const newKey = randomUUID();
        const workspace = await workspaceRepository.updateExtensionApiKey(workspaceId, newKey);

        return {
            apiKey: workspace?.extensionApiKey ?? newKey,
        };
    },
};
