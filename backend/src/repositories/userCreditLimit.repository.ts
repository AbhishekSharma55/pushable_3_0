import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { userCreditLimits } from "../db/schema/index.ts";

export const userCreditLimitRepository = {
    async findByUser(workspaceId: string, userId: string) {
        const result = await db
            .select()
            .from(userCreditLimits)
            .where(
                and(
                    eq(userCreditLimits.workspaceId, workspaceId),
                    eq(userCreditLimits.userId, userId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async upsert(data: {
        workspaceId: string;
        userId: string;
        creditLimit: number;
        periodEnd?: Date | null;
    }) {
        const existing = await this.findByUser(data.workspaceId, data.userId);

        if (existing) {
            const result = await db
                .update(userCreditLimits)
                .set({
                    creditLimit: data.creditLimit,
                    ...(data.periodEnd !== undefined
                        ? { periodEnd: data.periodEnd }
                        : {}),
                    updatedAt: new Date(),
                })
                .where(eq(userCreditLimits.id, existing.id))
                .returning();
            return result[0];
        }

        const result = await db
            .insert(userCreditLimits)
            .values({
                workspaceId: data.workspaceId,
                userId: data.userId,
                creditLimit: data.creditLimit,
                periodEnd: data.periodEnd ?? undefined,
            })
            .returning();
        return result[0];
    },

    async incrementUsed(workspaceId: string, userId: string, amount: number) {
        const result = await db
            .update(userCreditLimits)
            .set({
                creditsUsed: sql`${userCreditLimits.creditsUsed} + ${amount}`,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(userCreditLimits.workspaceId, workspaceId),
                    eq(userCreditLimits.userId, userId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async resetUsed(workspaceId: string, userId: string) {
        const result = await db
            .update(userCreditLimits)
            .set({
                creditsUsed: 0,
                periodStart: new Date(),
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(userCreditLimits.workspaceId, workspaceId),
                    eq(userCreditLimits.userId, userId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(userCreditLimits)
            .where(eq(userCreditLimits.workspaceId, workspaceId));
    },

    async delete(workspaceId: string, userId: string) {
        await db
            .delete(userCreditLimits)
            .where(
                and(
                    eq(userCreditLimits.workspaceId, workspaceId),
                    eq(userCreditLimits.userId, userId)
                )
            );
    },
};
