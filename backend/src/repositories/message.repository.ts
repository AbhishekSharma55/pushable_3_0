import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { messages } from "../db/schema/index.ts";

export const messageRepository = {
    async create(data: {
        workspaceId: string;
        sessionId: string;
        role: "user" | "assistant" | "tool";
        content: string;
        tokenCount?: number;
    }) {
        const result = await db
            .insert(messages)
            .values({ ...data, tokenCount: data.tokenCount ?? 0 })
            .returning();
        return result[0];
    },

    async findBySession(sessionId: string, workspaceId: string) {
        return db
            .select()
            .from(messages)
            .where(
                and(
                    eq(messages.sessionId, sessionId),
                    eq(messages.workspaceId, workspaceId)
                )
            )
            .orderBy(asc(messages.createdAt));
    },
};
