import { agentRepository } from "../repositories/agent.repository.ts";
import { NotFoundError } from "../lib/errors.ts";

export const agentService = {
    async createAgent(
        data: {
            name: string;
            systemPrompt?: string;
            model?: string;
            temperature?: number;
        },
        workspaceId: string
    ) {
        return agentRepository.create({ ...data, workspaceId });
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
};
