import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { testCases } from "../db/schema/index.ts";

export const testCaseRepository = {
    async create(data: {
        suiteId: string;
        workspaceId: string;
        title: string;
        input: string;
        expectedBehavior: string;
    }) {
        const result = await db
            .insert(testCases)
            .values({
                suiteId: data.suiteId,
                workspaceId: data.workspaceId,
                title: data.title,
                input: data.input,
                expectedBehavior: data.expectedBehavior,
            })
            .returning();
        return result[0];
    },

    async createMany(cases: {
        suiteId: string;
        workspaceId: string;
        title: string;
        input: string;
        expectedBehavior: string;
    }[]) {
        if (cases.length === 0) return [];
        const result = await db
            .insert(testCases)
            .values(cases)
            .returning();
        return result;
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(testCases)
            .where(and(eq(testCases.id, id), eq(testCases.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findBySuite(suiteId: string, workspaceId: string) {
        return db
            .select()
            .from(testCases)
            .where(and(eq(testCases.suiteId, suiteId), eq(testCases.workspaceId, workspaceId)))
            .orderBy(testCases.createdAt);
    },

    async update(id: string, workspaceId: string, data: Partial<{
        title: string;
        input: string;
        expectedBehavior: string;
        actualResponse: string;
        status: string;
        evaluationNotes: string;
        executionTimeMs: number;
        executedAt: Date;
    }>) {
        const result = await db
            .update(testCases)
            .set(data)
            .where(and(eq(testCases.id, id), eq(testCases.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        const result = await db
            .delete(testCases)
            .where(and(eq(testCases.id, id), eq(testCases.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async getStatsForSuite(suiteId: string, workspaceId: string) {
        const result = await db
            .select({
                total: sql<number>`COUNT(*)`,
                passed: sql<number>`COUNT(*) FILTER (WHERE ${testCases.status} = 'passed')`,
                failed: sql<number>`COUNT(*) FILTER (WHERE ${testCases.status} = 'failed')`,
                pending: sql<number>`COUNT(*) FILTER (WHERE ${testCases.status} = 'pending')`,
                error: sql<number>`COUNT(*) FILTER (WHERE ${testCases.status} = 'error')`,
            })
            .from(testCases)
            .where(and(eq(testCases.suiteId, suiteId), eq(testCases.workspaceId, workspaceId)));
        const r = result[0];
        return {
            total: Number(r?.total ?? 0),
            passed: Number(r?.passed ?? 0),
            failed: Number(r?.failed ?? 0),
            pending: Number(r?.pending ?? 0),
            error: Number(r?.error ?? 0),
        };
    },

    async getStatsForAgent(agentId: string, workspaceId: string) {
        const result = await db
            .select({
                total: sql<number>`COUNT(*)`,
                passed: sql<number>`COUNT(*) FILTER (WHERE ${testCases.status} = 'passed')`,
                failed: sql<number>`COUNT(*) FILTER (WHERE ${testCases.status} = 'failed')`,
            })
            .from(testCases)
            .innerJoin(
                // need to import testSuites for join
                sql`test_suites ON ${testCases.suiteId} = test_suites.id`
            )
            .where(
                and(
                    sql`test_suites.agent_id = ${agentId}`,
                    eq(testCases.workspaceId, workspaceId)
                )
            );
        const r = result[0];
        return {
            total: Number(r?.total ?? 0),
            passed: Number(r?.passed ?? 0),
            failed: Number(r?.failed ?? 0),
        };
    },
};
