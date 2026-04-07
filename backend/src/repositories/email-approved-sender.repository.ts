import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { emailApprovedSenders } from "../db/schema/index.ts";

export const emailApprovedSenderRepository = {
    async create(data: {
        workspaceId: string;
        senderPattern: string;
        note?: string;
    }) {
        const result = await db
            .insert(emailApprovedSenders)
            .values(data)
            .returning();
        return result[0];
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(emailApprovedSenders)
            .where(eq(emailApprovedSenders.workspaceId, workspaceId))
            .orderBy(emailApprovedSenders.createdAt);
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(emailApprovedSenders)
            .where(
                and(
                    eq(emailApprovedSenders.id, id),
                    eq(emailApprovedSenders.workspaceId, workspaceId)
                )
            );
    },

    async isApproved(workspaceId: string, senderEmail: string): Promise<boolean> {
        const patterns = await db
            .select()
            .from(emailApprovedSenders)
            .where(eq(emailApprovedSenders.workspaceId, workspaceId));

        if (patterns.length === 0) return false;

        const normalizedSender = senderEmail.toLowerCase();
        const senderDomain = normalizedSender.split("@")[1];

        return patterns.some((p) => {
            const pattern = p.senderPattern.toLowerCase();
            // Wildcard domain match: *@domain.com
            if (pattern.startsWith("*@")) {
                return senderDomain === pattern.slice(2);
            }
            // Universal wildcard
            if (pattern === "*" || pattern === "*@*") {
                return true;
            }
            // Exact match
            return normalizedSender === pattern;
        });
    },
};
