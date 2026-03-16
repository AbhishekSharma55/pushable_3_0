import { sessionRepository } from "../repositories/session.repository.ts";
import { messageRepository } from "../repositories/message.repository.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { NotFoundError } from "../lib/errors.ts";

export const sessionService = {
    async createSession(
        data: { agentId: string; title: string },
        workspaceId: string
    ) {
        // Verify agent exists in workspace
        const agent = await agentRepository.findById(
            data.agentId,
            workspaceId
        );
        if (!agent) {
            throw new NotFoundError("Agent not found in this workspace");
        }

        return sessionRepository.create({
            workspaceId,
            agentId: data.agentId,
            title: data.title,
        });
    },

    async getSessions(agentId: string, workspaceId: string) {
        return sessionRepository.findByAgent(agentId, workspaceId);
    },

    async getSession(id: string, workspaceId: string) {
        const session = await sessionRepository.findById(id, workspaceId);
        if (!session) {
            throw new NotFoundError("Session not found");
        }
        return session;
    },

    async deleteSession(id: string, workspaceId: string) {
        const session = await sessionRepository.findById(id, workspaceId);
        if (!session) {
            throw new NotFoundError("Session not found");
        }
        await sessionRepository.delete(id, workspaceId);
    },

    async getMessages(sessionId: string, workspaceId: string) {
        // Verify session exists
        const session = await sessionRepository.findById(
            sessionId,
            workspaceId
        );
        if (!session) {
            throw new NotFoundError("Session not found");
        }
        return messageRepository.findBySession(sessionId, workspaceId);
    },
};
