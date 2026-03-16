import { permissionRepository } from "../repositories/permission.repository.ts";

export const permissionService = {
    async setPermissions(
        agentId: string,
        workspaceId: string,
        permissions: {
            resourceType: "tool" | "kb" | "skill";
            resourceId: string;
            allowed: boolean;
        }[]
    ) {
        const results = [];
        for (const perm of permissions) {
            const result = await permissionRepository.setPermission({
                agentId,
                workspaceId,
                resourceType: perm.resourceType,
                resourceId: perm.resourceId,
                allowed: perm.allowed,
            });
            results.push(result);
        }
        return results;
    },

    async getAgentPermissions(agentId: string, workspaceId: string) {
        return permissionRepository.getPermissions(agentId, workspaceId);
    },
};
