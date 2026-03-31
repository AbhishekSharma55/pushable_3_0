import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "../db/client.ts";
import { runReports } from "../db/schema/index.ts";
import { agents } from "../db/schema/agents.ts";

export const runReportRepository = {
    async create(data: {
        workspaceId: string;
        agentId: string;
        projectId?: string | null;
        sessionId?: string | null;
        scheduleId?: string | null;
        summary: string;
        actionsTaken?: string | null;
        outcomes?: string | null;
        issues?: string | null;
        metrics?: Record<string, unknown>;
        data?: Record<string, unknown>;
        runType?: string;
        startedAt?: Date;
        completedAt?: Date | null;
    }) {
        const result = await db
            .insert(runReports)
            .values({
                workspaceId: data.workspaceId,
                agentId: data.agentId,
                projectId: data.projectId || null,
                sessionId: data.sessionId || null,
                scheduleId: data.scheduleId || null,
                summary: data.summary,
                actionsTaken: data.actionsTaken || null,
                outcomes: data.outcomes || null,
                issues: data.issues || null,
                metrics: data.metrics || {},
                data: data.data || {},
                runType: data.runType || "scheduled",
                startedAt: data.startedAt || new Date(),
                completedAt: data.completedAt || null,
            })
            .returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(runReports)
            .where(and(eq(runReports.id, id), eq(runReports.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findByProject(projectId: string, workspaceId: string, opts?: { since?: Date; limit?: number }) {
        const conditions = [
            eq(runReports.projectId, projectId),
            eq(runReports.workspaceId, workspaceId),
        ];
        if (opts?.since) conditions.push(gte(runReports.createdAt, opts.since));

        const query = db
            .select({
                report: runReports,
                agent: { id: agents.id, name: agents.name },
            })
            .from(runReports)
            .innerJoin(agents, eq(runReports.agentId, agents.id))
            .where(and(...conditions))
            .orderBy(desc(runReports.createdAt));

        if (opts?.limit) query.limit(opts.limit);
        return query;
    },

    async findByAgent(agentId: string, workspaceId: string, opts?: { since?: Date; limit?: number }) {
        const conditions = [
            eq(runReports.agentId, agentId),
            eq(runReports.workspaceId, workspaceId),
        ];
        if (opts?.since) conditions.push(gte(runReports.createdAt, opts.since));

        const query = db
            .select()
            .from(runReports)
            .where(and(...conditions))
            .orderBy(desc(runReports.createdAt));

        if (opts?.limit) query.limit(opts.limit);
        return query;
    },

    async findSinceDate(workspaceId: string, since: Date, projectId?: string) {
        const conditions = [
            eq(runReports.workspaceId, workspaceId),
            gte(runReports.createdAt, since),
        ];
        if (projectId) conditions.push(eq(runReports.projectId, projectId));

        return db
            .select({
                report: runReports,
                agent: { id: agents.id, name: agents.name },
            })
            .from(runReports)
            .innerJoin(agents, eq(runReports.agentId, agents.id))
            .where(and(...conditions))
            .orderBy(desc(runReports.createdAt));
    },

    async findByWorkspace(workspaceId: string, opts?: {
        agentId?: string;
        projectId?: string;
        since?: Date;
        limit?: number;
        offset?: number;
    }) {
        const conditions = [eq(runReports.workspaceId, workspaceId)];
        if (opts?.agentId) conditions.push(eq(runReports.agentId, opts.agentId));
        if (opts?.projectId) conditions.push(eq(runReports.projectId, opts.projectId));
        if (opts?.since) conditions.push(gte(runReports.createdAt, opts.since));

        const query = db
            .select({
                report: runReports,
                agent: { id: agents.id, name: agents.name },
            })
            .from(runReports)
            .innerJoin(agents, eq(runReports.agentId, agents.id))
            .where(and(...conditions))
            .orderBy(desc(runReports.createdAt));

        if (opts?.limit) query.limit(opts.limit);
        if (opts?.offset) query.offset(opts.offset);
        return query;
    },
};
