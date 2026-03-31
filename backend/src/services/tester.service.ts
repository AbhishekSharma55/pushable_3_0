import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agents } from "../db/schema/index.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { logger } from "../lib/logger.ts";

const TESTER_DEFAULT_MODEL = "anthropic/claude-opus-4.6";

export const testerService = {
    async getOrCreateTester(workspaceId: string) {
        // Check if Tester already exists
        const existing = await db
            .select()
            .from(agents)
            .where(
                and(
                    eq(agents.workspaceId, workspaceId),
                    eq(agents.isTester, true)
                )
            )
            .limit(1);

        if (existing[0]) return existing[0];

        // Create the Tester agent
        const tester = await agentRepository.create({
            workspaceId,
            name: "Tester",
            emoji: "🧪",
            systemPrompt: "",
            model: TESTER_DEFAULT_MODEL,
            temperature: 0.3,
            browserType: "cloud",
            browserEnabled: false,
            bucketFolder: "/tester",
        });

        // Set tester flags
        await db
            .update(agents)
            .set({
                isTester: true,
                agentType: "tester",
            })
            .where(eq(agents.id, tester.id));

        // Set full system permissions (needs to read agent configs)
        await agentRepository.updateSystemPermissions(tester.id, workspaceId, {
            systemLevelAccess: true,
            canManageKB: true,
            canManageSkills: true,
            canManageTools: true,
            canManageSchedules: false,
            canManageChannels: false,
            canManageAgents: true,
            canManageBucket: true,
            canExecutePython: false,
        });

        logger.info({ workspaceId, testerId: tester.id }, "Tester agent created for workspace");

        return agentRepository.findById(tester.id, workspaceId);
    },

    async isTester(agentId: string, workspaceId: string) {
        const agent = await agentRepository.findById(agentId, workspaceId);
        return agent?.isTester === true;
    },
};
