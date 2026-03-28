import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { testSuites, testCases } from "../db/schema/index.ts";
import { agents } from "../db/schema/agents.ts";

export const testSuiteRepository = {
    async create(data: {
        workspaceId: string;
        agentId: string;
        name: string;
        description?: string;
        status?: string;
        createdBy?: string;
    }) {
        const result = await db
            .insert(testSuites)
            .values({
                workspaceId: data.workspaceId,
                agentId: data.agentId,
                name: data.name,
                description: data.description || null,
                status: data.status || "draft",
                createdBy: data.createdBy || null,
            })
            .returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(testSuites)
            .where(and(eq(testSuites.id, id), eq(testSuites.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findByIdWithCases(id: string, workspaceId: string) {
        const suite = await this.findById(id, workspaceId);
        if (!suite) return null;

        const cases = await db
            .select()
            .from(testCases)
            .where(and(eq(testCases.suiteId, id), eq(testCases.workspaceId, workspaceId)))
            .orderBy(testCases.createdAt);

        // Get target agent info
        const agent = await db
            .select({ id: agents.id, name: agents.name, model: agents.model })
            .from(agents)
            .where(eq(agents.id, suite.agentId))
            .limit(1);

        return { ...suite, cases, agent: agent[0] ?? null };
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select({
                suite: testSuites,
                agent: { id: agents.id, name: agents.name, emoji: agents.emoji },
            })
            .from(testSuites)
            .innerJoin(agents, eq(testSuites.agentId, agents.id))
            .where(eq(testSuites.workspaceId, workspaceId))
            .orderBy(desc(testSuites.createdAt));
    },

    async findByAgent(agentId: string, workspaceId: string) {
        return db
            .select()
            .from(testSuites)
            .where(and(eq(testSuites.agentId, agentId), eq(testSuites.workspaceId, workspaceId)))
            .orderBy(desc(testSuites.createdAt));
    },

    async update(id: string, workspaceId: string, data: Partial<{
        name: string;
        description: string;
        status: string;
    }>) {
        const result = await db
            .update(testSuites)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(testSuites.id, id), eq(testSuites.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        const result = await db
            .delete(testSuites)
            .where(and(eq(testSuites.id, id), eq(testSuites.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },
};
