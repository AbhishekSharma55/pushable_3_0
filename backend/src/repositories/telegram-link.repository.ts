import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { telegramUserLinks } from "../db/schema/index.ts";

export const telegramLinkRepository = {
    async findByTelegramUserId(telegramUserId: string) {
        const result = await db
            .select()
            .from(telegramUserLinks)
            .where(eq(telegramUserLinks.telegramUserId, telegramUserId))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(telegramUserLinks)
            .where(eq(telegramUserLinks.workspaceId, workspaceId))
            .orderBy(telegramUserLinks.createdAt);
    },

    async findByWorkspaceAndUser(workspaceId: string, userId: string) {
        const result = await db
            .select()
            .from(telegramUserLinks)
            .where(
                and(
                    eq(telegramUserLinks.workspaceId, workspaceId),
                    eq(telegramUserLinks.userId, userId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async create(data: {
        telegramUserId: string;
        telegramUsername?: string;
        telegramFirstName?: string;
        telegramChatId?: string;
        workspaceId: string;
        userId?: string;
    }) {
        const result = await db
            .insert(telegramUserLinks)
            .values({ ...data, verifiedAt: new Date() })
            .returning();
        return result[0];
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(telegramUserLinks)
            .where(
                and(
                    eq(telegramUserLinks.id, id),
                    eq(telegramUserLinks.workspaceId, workspaceId)
                )
            );
    },

    async updateChatInfo(
        telegramUserId: string,
        chatId: string,
        username?: string,
        firstName?: string
    ) {
        await db
            .update(telegramUserLinks)
            .set({
                telegramChatId: chatId,
                ...(username && { telegramUsername: username }),
                ...(firstName && { telegramFirstName: firstName }),
                updatedAt: new Date(),
            })
            .where(eq(telegramUserLinks.telegramUserId, telegramUserId));
    },

    async updateLastMessageAt(telegramUserId: string) {
        await db
            .update(telegramUserLinks)
            .set({ lastMessageAt: new Date() })
            .where(eq(telegramUserLinks.telegramUserId, telegramUserId));
    },
};
