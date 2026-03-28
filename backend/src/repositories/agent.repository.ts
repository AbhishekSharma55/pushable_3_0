import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agents } from "../db/schema/index.ts";

export const agentRepository = {
    async create(data: {
        workspaceId: string;
        name: string;
        emoji?: string;
        systemPrompt?: string;
        model?: string;
        temperature?: number;
        browserType?: string;
        browserEnabled?: boolean;
        browserProxyId?: string | null;
        bucketFolder?: string;
    }) {
        const result = await db.insert(agents).values(data).returning();
        return result[0];
    },

    async updateSystemPermissions(
        id: string,
        workspaceId: string,
        data: {
            systemLevelAccess: boolean;
            canManageKB: boolean;
            canManageSkills: boolean;
            canManageTools: boolean;
            canManageSchedules: boolean;
            canManageChannels: boolean;
            canManageAgents: boolean;
            canManageBucket?: boolean;
            canExecutePython?: boolean;
        }
    ) {
        // If systemLevelAccess is off, force all system-level permissions to false
        // canExecutePython is independent of systemLevelAccess
        const perms = data.systemLevelAccess
            ? {
                  systemLevelAccess: data.systemLevelAccess,
                  canManageKB: data.canManageKB,
                  canManageSkills: data.canManageSkills,
                  canManageTools: data.canManageTools,
                  canManageSchedules: data.canManageSchedules,
                  canManageChannels: data.canManageChannels,
                  canManageAgents: data.canManageAgents,
                  ...(data.canManageBucket !== undefined && { canManageBucket: data.canManageBucket }),
                  ...(data.canExecutePython !== undefined && { canExecutePython: data.canExecutePython }),
              }
            : {
                  systemLevelAccess: false,
                  canManageKB: false,
                  canManageSkills: false,
                  canManageTools: false,
                  canManageSchedules: false,
                  canManageChannels: false,
                  canManageAgents: false,
                  ...(data.canManageBucket !== undefined && { canManageBucket: data.canManageBucket }),
                  ...(data.canExecutePython !== undefined && { canExecutePython: data.canExecutePython }),
              };
        const result = await db
            .update(agents)
            .set({ ...perms, updatedAt: new Date() })
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(agents)
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(agents)
            .where(eq(agents.workspaceId, workspaceId))
            .orderBy(agents.createdAt);
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            emoji: string;
            systemPrompt: string;
            model: string;
            temperature: number;
            browserType: string;
            browserEnabled: boolean;
            browserProxyId: string | null;
        }>
    ) {
        const result = await db
            .update(agents)
            .set({ ...data, updatedAt: new Date() })
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(agents)
            .where(and(eq(agents.id, id), eq(agents.workspaceId, workspaceId)));
    },
};
