import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { whatsappUserLinks } from "../db/schema/index.ts";

export const whatsappLinkRepository = {
    async findByPhone(whatsappPhone: string) {
        const result = await db
            .select()
            .from(whatsappUserLinks)
            .where(eq(whatsappUserLinks.whatsappPhone, whatsappPhone))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(whatsappUserLinks)
            .where(eq(whatsappUserLinks.workspaceId, workspaceId))
            .orderBy(whatsappUserLinks.createdAt);
    },

    async findByWorkspaceAndUser(workspaceId: string, userId: string) {
        const result = await db
            .select()
            .from(whatsappUserLinks)
            .where(
                and(
                    eq(whatsappUserLinks.workspaceId, workspaceId),
                    eq(whatsappUserLinks.userId, userId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async create(data: {
        whatsappPhone: string;
        whatsappName?: string;
        workspaceId: string;
        userId?: string;
    }) {
        const result = await db
            .insert(whatsappUserLinks)
            .values({ ...data, verifiedAt: new Date() })
            .returning();
        return result[0];
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(whatsappUserLinks)
            .where(
                and(
                    eq(whatsappUserLinks.id, id),
                    eq(whatsappUserLinks.workspaceId, workspaceId)
                )
            );
    },

    async updateLastMessageAt(whatsappPhone: string) {
        await db
            .update(whatsappUserLinks)
            .set({ lastMessageAt: new Date() })
            .where(eq(whatsappUserLinks.whatsappPhone, whatsappPhone));
    },
};
