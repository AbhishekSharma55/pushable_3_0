import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
    workspaces,
    workspaceMembers,
    credits,
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
};
