import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { runs } from "../db/schema/index.ts";
import { sessions } from "../db/schema/index.ts";
import { agents } from "../db/schema/index.ts";

export const runRepository = {
    async create(data: {
        sessionId: string;
        workspaceId: string;
        status?: "queued" | "in_progress" | "completed" | "failed" | "interrupted" | "cancelled";
        metadata?: Record<string, unknown>;
    }) {
        const result = await db
            .insert(runs)
            .values({
                sessionId: data.sessionId,
                workspaceId: data.workspaceId,
                status: data.status ?? "in_progress",
                metadata: data.metadata ?? {},
            })
            .returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(runs)
            .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findActiveBySession(sessionId: string, workspaceId: string) {
        const result = await db
            .select()
            .from(runs)
            .where(
                and(
                    eq(runs.sessionId, sessionId),
                    eq(runs.workspaceId, workspaceId),
                    inArray(runs.status, ["queued", "in_progress", "interrupted"])
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findInterruptedByWorkspace(workspaceId: string) {
        const result = await db
            .select({
                id: runs.id,
                sessionId: runs.sessionId,
                workspaceId: runs.workspaceId,
                status: runs.status,
                metadata: runs.metadata,
                createdAt: runs.createdAt,
                updatedAt: runs.updatedAt,
                sessionTitle: sessions.title,
                agentId: sessions.agentId,
                agentName: agents.name,
            })
            .from(runs)
            .innerJoin(sessions, eq(runs.sessionId, sessions.id))
            .innerJoin(agents, eq(sessions.agentId, agents.id))
            .where(
                and(
                    eq(runs.workspaceId, workspaceId),
                    eq(runs.status, "interrupted")
                )
            )
            .orderBy(desc(runs.updatedAt));
        return result;
    },

    async updateStatus(
        id: string,
        status: "queued" | "in_progress" | "completed" | "failed" | "interrupted" | "cancelled",
        error?: string
    ) {
        const values: Record<string, unknown> = {
            status,
            updatedAt: new Date(),
        };
        if (error !== undefined) {
            values.error = error;
        }
        await db.update(runs).set(values).where(eq(runs.id, id));
    },
};
