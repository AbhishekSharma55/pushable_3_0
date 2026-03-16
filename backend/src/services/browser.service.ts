import { randomUUID } from "crypto";
import { browserRepository } from "../repositories/browser.repository.ts";
import { browserClient } from "../lib/browser-client.ts";
import { NotFoundError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export const browserService = {
    async createProfile(
        data: { name: string; assignedAgentId?: string | null; os?: string },
        workspaceId: string
    ) {
        const profilePath = `${workspaceId}/${randomUUID()}`;
        return browserRepository.createProfile({
            workspaceId,
            name: data.name,
            profilePath,
            assignedAgentId: data.assignedAgentId ?? null,
            os: data.os ?? "windows",
        });
    },

    async getProfiles(workspaceId: string) {
        return browserRepository.findProfiles(workspaceId);
    },

    async getProfile(id: string, workspaceId: string) {
        const profile = await browserRepository.findProfileById(
            id,
            workspaceId
        );
        if (!profile) throw new NotFoundError("Browser profile not found");
        return profile;
    },

    async updateProfile(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            assignedAgentId: string | null;
            os: string;
            status: "active" | "inactive";
        }>
    ) {
        const profile = await browserRepository.findProfileById(
            id,
            workspaceId
        );
        if (!profile) throw new NotFoundError("Browser profile not found");
        return browserRepository.updateProfile(id, workspaceId, data);
    },

    async deleteProfile(id: string, workspaceId: string) {
        const profile = await browserRepository.findProfileById(
            id,
            workspaceId
        );
        if (!profile) throw new NotFoundError("Browser profile not found");
        await browserRepository.deleteProfile(id, workspaceId);
    },

    async startSession(
        profileId: string,
        workspaceId: string,
        agentId?: string
    ) {
        const profile = await browserRepository.findProfileById(
            profileId,
            workspaceId
        );
        if (!profile) throw new NotFoundError("Browser profile not found");

        const session = await browserRepository.createSession({
            workspaceId,
            profileId,
            agentId: agentId ?? null,
        });

        try {
            const wsUrl = await browserClient.createSession(
                session.id,
                workspaceId,
                profile.profilePath
            );
            await browserRepository.updateSessionStatus(session.id, "active");
            return { sessionId: session.id, wsUrl };
        } catch (error) {
            logger.error(
                { error, sessionId: session.id },
                "Failed to start browser session"
            );
            await browserRepository.updateSessionStatus(session.id, "error");
            throw error;
        }
    },

    async endSession(sessionId: string, workspaceId: string) {
        try {
            await browserClient.closeSession(sessionId);
        } catch (error) {
            logger.warn(
                { error, sessionId },
                "Failed to close browser in browser-service"
            );
        }
        await browserRepository.updateSessionStatus(
            sessionId,
            "closed",
            new Date()
        );
    },

    async getSessions(workspaceId: string) {
        return browserRepository.findSessions(workspaceId);
    },
};
