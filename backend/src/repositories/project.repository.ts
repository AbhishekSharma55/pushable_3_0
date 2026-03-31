import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { projects, projectAgents, projectKnowledgeBases, projectMilestones } from "../db/schema/index.ts";
import { agents } from "../db/schema/agents.ts";
import { knowledgeBases } from "../db/schema/knowledgeBases.ts";

export const projectRepository = {
    async create(data: {
        workspaceId: string;
        name: string;
        description?: string;
        instructions?: string;
        status?: string;
        createdBy?: string;
    }) {
        const result = await db
            .insert(projects)
            .values({
                workspaceId: data.workspaceId,
                name: data.name,
                description: data.description || null,
                instructions: data.instructions || null,
                status: data.status || "active",
                createdBy: data.createdBy || null,
            })
            .returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(projects)
            .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findByIdWithDetails(id: string, workspaceId: string) {
        const project = await this.findById(id, workspaceId);
        if (!project) return null;

        const [milestones, agentsResult, kbsResult] = await Promise.all([
            this.getMilestones(id, workspaceId),
            this.getAgents(id, workspaceId),
            this.getKBs(id, workspaceId),
        ]);

        return { ...project, milestones, agents: agentsResult, knowledgeBases: kbsResult };
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(projects)
            .where(eq(projects.workspaceId, workspaceId))
            .orderBy(desc(projects.createdAt));
    },

    async update(id: string, workspaceId: string, data: Partial<{
        name: string;
        description: string;
        instructions: string;
        status: string;
    }>) {
        const result = await db
            .update(projects)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        const result = await db
            .delete(projects)
            .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    // --- Agent assignments ---
    async assignAgent(projectId: string, agentId: string, workspaceId: string, roleInProject?: string) {
        const result = await db
            .insert(projectAgents)
            .values({
                projectId,
                agentId,
                workspaceId,
                roleInProject: roleInProject || null,
            })
            .onConflictDoNothing()
            .returning();
        return result[0] ?? null;
    },

    async removeAgent(projectId: string, agentId: string, workspaceId: string) {
        const result = await db
            .delete(projectAgents)
            .where(
                and(
                    eq(projectAgents.projectId, projectId),
                    eq(projectAgents.agentId, agentId),
                    eq(projectAgents.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async getAgents(projectId: string, workspaceId: string) {
        const rows = await db
            .select({
                id: projectAgents.id,
                projectId: projectAgents.projectId,
                agentId: projectAgents.agentId,
                roleInProject: projectAgents.roleInProject,
                assignedAt: projectAgents.assignedAt,
                agent: {
                    id: agents.id,
                    name: agents.name,
                    model: agents.model,
                    isCeo: agents.isCeo,
                    agentType: agents.agentType,
                },
            })
            .from(projectAgents)
            .innerJoin(agents, eq(projectAgents.agentId, agents.id))
            .where(
                and(
                    eq(projectAgents.projectId, projectId),
                    eq(projectAgents.workspaceId, workspaceId)
                )
            );
        return rows;
    },

    async getProjectsForAgent(agentId: string, workspaceId: string) {
        const rows = await db
            .select({
                id: projects.id,
                name: projects.name,
                status: projects.status,
                description: projects.description,
            })
            .from(projectAgents)
            .innerJoin(projects, eq(projectAgents.projectId, projects.id))
            .where(
                and(
                    eq(projectAgents.agentId, agentId),
                    eq(projectAgents.workspaceId, workspaceId)
                )
            );
        return rows;
    },

    // --- KB assignments ---
    async assignKB(projectId: string, kbId: string, workspaceId: string) {
        const result = await db
            .insert(projectKnowledgeBases)
            .values({ projectId, kbId, workspaceId })
            .onConflictDoNothing()
            .returning();
        return result[0] ?? null;
    },

    async removeKB(projectId: string, kbId: string, workspaceId: string) {
        const result = await db
            .delete(projectKnowledgeBases)
            .where(
                and(
                    eq(projectKnowledgeBases.projectId, projectId),
                    eq(projectKnowledgeBases.kbId, kbId),
                    eq(projectKnowledgeBases.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async getKBs(projectId: string, workspaceId: string) {
        const rows = await db
            .select({
                id: projectKnowledgeBases.id,
                projectId: projectKnowledgeBases.projectId,
                kbId: projectKnowledgeBases.kbId,
                assignedAt: projectKnowledgeBases.assignedAt,
                knowledgeBase: {
                    id: knowledgeBases.id,
                    name: knowledgeBases.name,
                    description: knowledgeBases.description,
                },
            })
            .from(projectKnowledgeBases)
            .innerJoin(knowledgeBases, eq(projectKnowledgeBases.kbId, knowledgeBases.id))
            .where(
                and(
                    eq(projectKnowledgeBases.projectId, projectId),
                    eq(projectKnowledgeBases.workspaceId, workspaceId)
                )
            );
        return rows;
    },

    // --- Milestones (convenience pass-through) ---
    async getMilestones(projectId: string, workspaceId: string) {
        return db
            .select()
            .from(projectMilestones)
            .where(
                and(
                    eq(projectMilestones.projectId, projectId),
                    eq(projectMilestones.workspaceId, workspaceId)
                )
            )
            .orderBy(projectMilestones.sortOrder);
    },
};
