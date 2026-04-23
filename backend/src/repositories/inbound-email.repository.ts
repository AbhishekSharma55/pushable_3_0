import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { inboundEmails } from "../db/schema/index.ts";

export type EmailAttachmentMeta = {
    filename: string;
    mimeType: string;
    size: number;
    storageKey: string;
    isInline: boolean;
    contentId?: string;
};

type EmailStatus =
    | "received"
    | "routing"
    | "processing"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "completed"
    | "failed"
    | "spam";

export const inboundEmailRepository = {
    async create(data: {
        workspaceId: string;
        emailAddressId?: string;
        fromAddress: string;
        fromName?: string;
        toAddress: string;
        subject?: string;
        bodyText?: string;
        bodyHtml?: string;
        cc?: string;
        bcc?: string;
        messageId?: string;
        inReplyTo?: string;
        references?: string;
        rawPayload?: unknown;
        attachments?: EmailAttachmentMeta[];
    }) {
        const result = await db
            .insert(inboundEmails)
            .values({
                ...data,
                statusHistory: [
                    {
                        status: "received",
                        timestamp: new Date().toISOString(),
                        detail: "Email received from webhook",
                    },
                ],
            })
            .returning();
        return result[0];
    },

    async findByWorkspace(
        workspaceId: string,
        opts: { status?: EmailStatus; limit?: number; offset?: number } = {}
    ) {
        const { status, limit = 50, offset = 0 } = opts;

        const conditions = [eq(inboundEmails.workspaceId, workspaceId)];
        if (status) {
            conditions.push(eq(inboundEmails.status, status));
        }

        return db
            .select()
            .from(inboundEmails)
            .where(and(...conditions))
            .orderBy(desc(inboundEmails.createdAt))
            .limit(limit)
            .offset(offset);
    },

    async countByWorkspace(
        workspaceId: string,
        status?: EmailStatus
    ) {
        const conditions = [eq(inboundEmails.workspaceId, workspaceId)];
        if (status) {
            conditions.push(eq(inboundEmails.status, status));
        }

        const result = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(inboundEmails)
            .where(and(...conditions));
        return result[0]?.count ?? 0;
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(inboundEmails)
            .where(
                and(
                    eq(inboundEmails.id, id),
                    eq(inboundEmails.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByIdGlobal(id: string) {
        const result = await db
            .select()
            .from(inboundEmails)
            .where(eq(inboundEmails.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async updateStatus(id: string, status: EmailStatus, detail?: string) {
        const historyEntry = {
            status,
            timestamp: new Date().toISOString(),
            detail: detail || `Status changed to ${status}`,
        };

        await db
            .update(inboundEmails)
            .set({
                status,
                updatedAt: new Date(),
                statusHistory: sql`${inboundEmails.statusHistory} || ${JSON.stringify([historyEntry])}::jsonb`,
            })
            .where(eq(inboundEmails.id, id));
    },

    async updateSessionId(id: string, sessionId: string) {
        await db
            .update(inboundEmails)
            .set({ sessionId, updatedAt: new Date() })
            .where(eq(inboundEmails.id, id));
    },

    async updateRoutedAgent(id: string, agentId: string) {
        await db
            .update(inboundEmails)
            .set({ routedToAgentId: agentId, updatedAt: new Date() })
            .where(eq(inboundEmails.id, id));
    },

    async updateReply(id: string, replyContent: string) {
        await db
            .update(inboundEmails)
            .set({
                replySent: true,
                replyContent,
                updatedAt: new Date(),
            })
            .where(eq(inboundEmails.id, id));
    },

    async updateError(id: string, errorMessage: string) {
        await db
            .update(inboundEmails)
            .set({
                status: "failed",
                errorMessage,
                updatedAt: new Date(),
                statusHistory: sql`${inboundEmails.statusHistory} || ${JSON.stringify([
                    {
                        status: "failed",
                        timestamp: new Date().toISOString(),
                        detail: errorMessage,
                    },
                ])}::jsonb`,
            })
            .where(eq(inboundEmails.id, id));
    },

    async findByMessageId(messageId: string) {
        const result = await db
            .select()
            .from(inboundEmails)
            .where(eq(inboundEmails.messageId, messageId))
            .limit(1);
        return result[0] ?? null;
    },
};
