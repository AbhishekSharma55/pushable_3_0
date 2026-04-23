import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { slackUserLinks } from "../db/schema/index.ts";

export const slackLinkRepository = {
    async findBySlackIdentity(teamId: string, slackUserId: string) {
        const result = await db
            .select()
            .from(slackUserLinks)
            .where(
                and(
                    eq(slackUserLinks.slackTeamId, teamId),
                    eq(slackUserLinks.slackUserId, slackUserId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(slackUserLinks)
            .where(eq(slackUserLinks.workspaceId, workspaceId))
            .orderBy(slackUserLinks.createdAt);
    },

    async findByWorkspaceAndUser(workspaceId: string, userId: string) {
        const result = await db
            .select()
            .from(slackUserLinks)
            .where(
                and(
                    eq(slackUserLinks.workspaceId, workspaceId),
                    eq(slackUserLinks.userId, userId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async create(data: {
        slackUserId: string;
        slackTeamId: string;
        slackUsername?: string;
        slackDisplayName?: string;
        slackDmChannelId?: string;
        workspaceId: string;
        userId?: string;
    }) {
        const result = await db
            .insert(slackUserLinks)
            .values({ ...data, verifiedAt: new Date() })
            .returning();
        return result[0];
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(slackUserLinks)
            .where(
                and(
                    eq(slackUserLinks.id, id),
                    eq(slackUserLinks.workspaceId, workspaceId)
                )
            );
    },

    async deleteByTeamId(teamId: string) {
        await db
            .delete(slackUserLinks)
            .where(eq(slackUserLinks.slackTeamId, teamId));
    },

    async updateDmChannelInfo(
        teamId: string,
        slackUserId: string,
        dmChannelId: string,
        username?: string,
        displayName?: string
    ) {
        await db
            .update(slackUserLinks)
            .set({
                slackDmChannelId: dmChannelId,
                ...(username && { slackUsername: username }),
                ...(displayName && { slackDisplayName: displayName }),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(slackUserLinks.slackTeamId, teamId),
                    eq(slackUserLinks.slackUserId, slackUserId)
                )
            );
    },

    async updateLastMessageAt(teamId: string, slackUserId: string) {
        await db
            .update(slackUserLinks)
            .set({ lastMessageAt: new Date() })
            .where(
                and(
                    eq(slackUserLinks.slackTeamId, teamId),
                    eq(slackUserLinks.slackUserId, slackUserId)
                )
            );
    },
};
