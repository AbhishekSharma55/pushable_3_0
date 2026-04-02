import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
    workspaces,
    workspaceMembers,
    credits,
    users,
    userCreditLimits,
} from "../db/schema/index.ts";

export const workspaceRepository = {
    async create(data: { name: string; slug: string; ownerId: string; extensionApiKey?: string }) {
        const result = await db.insert(workspaces).values(data).returning();
        return result[0];
    },

    async findByUserId(userId: string) {
        const members = await db
            .select({ workspaceId: workspaceMembers.workspaceId })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.userId, userId));

        if (members.length === 0) return [];

        const workspaceIds = members.map((m) => m.workspaceId);

        return db
            .select()
            .from(workspaces)
            .where(inArray(workspaces.id, workspaceIds));
    },

    async findById(id: string) {
        const result = await db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async addMember(data: {
        workspaceId: string;
        userId: string;
        role: "owner" | "admin" | "member";
    }) {
        const result = await db
            .insert(workspaceMembers)
            .values(data)
            .returning();
        return result[0];
    },

    async isMember(workspaceId: string, userId: string) {
        const result = await db
            .select()
            .from(workspaceMembers)
            .where(
                and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.userId, userId)
                )
            )
            .limit(1);
        return result.length > 0;
    },

    async createCredits(workspaceId: string) {
        await db.insert(credits).values({ workspaceId });
    },

    async updateExtensionApiKey(workspaceId: string, apiKey: string) {
        const result = await db
            .update(workspaces)
            .set({ extensionApiKey: apiKey, updatedAt: new Date() })
            .where(eq(workspaces.id, workspaceId))
            .returning();
        return result[0] ?? null;
    },

    async findByExtensionApiKey(apiKey: string) {
        const result = await db
            .select()
            .from(workspaces)
            .where(eq(workspaces.extensionApiKey, apiKey))
            .limit(1);
        return result[0] ?? null;
    },

    async getMemberRole(
        workspaceId: string,
        userId: string
    ): Promise<"owner" | "admin" | "member" | null> {
        const result = await db
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .where(
                and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.userId, userId)
                )
            )
            .limit(1);
        return result[0]?.role ?? null;
    },

    async isOwnerOrAdmin(workspaceId: string, userId: string): Promise<boolean> {
        const role = await this.getMemberRole(workspaceId, userId);
        return role === "owner" || role === "admin";
    },

    async getMembersWithDetails(workspaceId: string) {
        return db
            .select({
                memberId: workspaceMembers.id,
                userId: workspaceMembers.userId,
                role: workspaceMembers.role,
                joinedAt: workspaceMembers.createdAt,
                userName: users.name,
                userEmail: users.email,
                creditLimit: userCreditLimits.creditLimit,
                creditsUsed: userCreditLimits.creditsUsed,
                periodStart: userCreditLimits.periodStart,
                periodEnd: userCreditLimits.periodEnd,
            })
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .leftJoin(
                userCreditLimits,
                and(
                    eq(userCreditLimits.workspaceId, workspaceMembers.workspaceId),
                    eq(userCreditLimits.userId, workspaceMembers.userId)
                )
            )
            .where(eq(workspaceMembers.workspaceId, workspaceId));
    },

    async removeMember(workspaceId: string, userId: string) {
        await db
            .delete(workspaceMembers)
            .where(
                and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.userId, userId)
                )
            );
    },

    async updateMemberRole(
        workspaceId: string,
        userId: string,
        role: "owner" | "admin" | "member"
    ) {
        const result = await db
            .update(workspaceMembers)
            .set({ role })
            .where(
                and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.userId, userId)
                )
            )
            .returning();
        return result[0] ?? null;
    },
};
