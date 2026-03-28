import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agents } from "../db/schema/index.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { logger } from "../lib/logger.ts";

const CEO_DEFAULT_MODEL = "claude-sonnet-4-20250514";

export const ceoService = {
    async getOrCreateCEO(workspaceId: string) {
        // Check if CEO already exists
        const existing = await db
            .select()
            .from(agents)
            .where(
                and(
                    eq(agents.workspaceId, workspaceId),
                    eq(agents.isCeo, true)
                )
            )
            .limit(1);

        if (existing[0]) return existing[0];

        // Create the CEO agent
        const ceo = await agentRepository.create({
            workspaceId,
            name: "CEO",
            emoji: "😎",
            systemPrompt: "", // CEO prompt is injected at graph level, not stored here
            model: CEO_DEFAULT_MODEL,
            temperature: 0.7,
            browserType: "cloud",
            browserEnabled: false,
            bucketFolder: "/ceo",
        });

        // Set CEO flags directly
        await db
            .update(agents)
            .set({
                isCeo: true,
                agentType: "ceo",
            })
            .where(eq(agents.id, ceo.id));

        // Set full system permissions
        await agentRepository.updateSystemPermissions(ceo.id, workspaceId, {
            systemLevelAccess: true,
            canManageKB: true,
            canManageSkills: true,
            canManageTools: true,
            canManageSchedules: true,
            canManageChannels: true,
            canManageAgents: true,
            canManageBucket: true,
            canExecutePython: false,
        });

        logger.info({ workspaceId, ceoId: ceo.id }, "CEO agent created for workspace");

        // Re-fetch with updated fields
        return agentRepository.findById(ceo.id, workspaceId);
    },

    async isCEO(agentId: string, workspaceId: string) {
        const agent = await agentRepository.findById(agentId, workspaceId);
        return agent?.isCeo === true;
    },
};
