import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { browserProfiles, browserSessions } from "../db/schema/index.ts";

export const browserRepository = {
    // ── Profiles ──

    async createProfile(data: {
        workspaceId: string;
        name: string;
        profilePath: string;
        assignedAgentId?: string | null;
        os?: string;
        metadata?: Record<string, unknown>;
    }) {
        const result = await db
            .insert(browserProfiles)
            .values(data)
            .returning();
        return result[0];
    },

    async findProfiles(workspaceId: string) {
        return db
            .select()
            .from(browserProfiles)
            .where(eq(browserProfiles.workspaceId, workspaceId))
            .orderBy(browserProfiles.createdAt);
    },

    async findProfileById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(browserProfiles)
            .where(
                and(
                    eq(browserProfiles.id, id),
                    eq(browserProfiles.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findProfileByAgentId(agentId: string, workspaceId: string) {
        const result = await db
            .select()
            .from(browserProfiles)
            .where(
                and(
                    eq(browserProfiles.assignedAgentId, agentId),
                    eq(browserProfiles.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async updateProfile(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            assignedAgentId: string | null;
            os: string;
            status: "active" | "inactive";
            metadata: Record<string, unknown>;
        }>
    ) {
        const result = await db
            .update(browserProfiles)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(browserProfiles.id, id),
                    eq(browserProfiles.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async deleteProfile(id: string, workspaceId: string) {
        await db
            .delete(browserProfiles)
            .where(
                and(
                    eq(browserProfiles.id, id),
                    eq(browserProfiles.workspaceId, workspaceId)
                )
            );
    },

    // ── Sessions ──

    async createSession(data: {
        workspaceId: string;
        profileId: string;
        agentId?: string | null;
        taskId?: string | null;
    }) {
        const result = await db
            .insert(browserSessions)
            .values(data)
            .returning();
        return result[0];
    },

    async findSessions(workspaceId: string) {
        return db
            .select()
            .from(browserSessions)
            .where(eq(browserSessions.workspaceId, workspaceId))
            .orderBy(browserSessions.createdAt);
    },

    async findActiveSessionByProfileId(profileId: string) {
        const result = await db
            .select()
            .from(browserSessions)
            .where(
                and(
                    eq(browserSessions.profileId, profileId),
                    eq(browserSessions.status, "active")
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async updateSessionStatus(
        id: string,
        status: "starting" | "active" | "closed" | "error",
        closedAt?: Date
    ) {
        const data: Record<string, unknown> = { status };
        if (closedAt) data.closedAt = closedAt;
        const result = await db
            .update(browserSessions)
            .set(data)
            .where(eq(browserSessions.id, id))
            .returning();
        return result[0] ?? null;
    },
};
