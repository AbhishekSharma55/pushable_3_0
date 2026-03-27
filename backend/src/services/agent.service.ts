import { agentRepository } from "../repositories/agent.repository.ts";
import { NotFoundError } from "../lib/errors.ts";

function slugifyAgentFolder(name: string): string {
    const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `/agent-${slug}`;
}

export const agentService = {
    async createAgent(
        data: {
            name: string;
            systemPrompt?: string;
            model?: string;
            temperature?: number;
            browserType?: string;
        },
        workspaceId: string
    ) {
        const bucketFolder = slugifyAgentFolder(data.name);
        return agentRepository.create({ ...data, workspaceId, bucketFolder });
    },

    async getAgents(workspaceId: string) {
        return agentRepository.findByWorkspace(workspaceId);
    },

    async getAgent(id: string, workspaceId: string) {
        const agent = await agentRepository.findById(id, workspaceId);
        if (!agent) {
            throw new NotFoundError("Agent not found");
        }
        return agent;
    },

    async updateAgent(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            systemPrompt: string;
            model: string;
            temperature: number;
            browserType: string;
            browserProxyId: string | null;
        }>
    ) {
        const agent = await agentRepository.findById(id, workspaceId);
        if (!agent) {
            throw new NotFoundError("Agent not found");
        }
        return agentRepository.update(id, workspaceId, data);
    },

    async deleteAgent(id: string, workspaceId: string) {
        const agent = await agentRepository.findById(id, workspaceId);
        if (!agent) {
            throw new NotFoundError("Agent not found");
        }
        await agentRepository.delete(id, workspaceId);
    },

    async updateSystemPermissions(
        id: string,
        workspaceId: string,
        data: {
            systemLevelAccess: boolean;
            canManageKB: boolean;
            canManageSkills: boolean;
            canManageTools: boolean;
            canManageSchedules: boolean;
            canManageChannels: boolean;
            canManageAgents: boolean;
            canManageBucket?: boolean;
            canExecutePython?: boolean;
        }
    ) {
        const agent = await agentRepository.findById(id, workspaceId);
        if (!agent) {
            throw new NotFoundError("Agent not found");
        }
        return agentRepository.updateSystemPermissions(id, workspaceId, data);
    },
};
