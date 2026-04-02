import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { userCreditLimitRepository } from "../repositories/userCreditLimit.repository.ts";
import { userAgentAccessRepository } from "../repositories/userAgentAccess.repository.ts";
import { requireOwner, requireOwnerOrAdmin } from "../lib/authorization.ts";
import { AppError, ForbiddenError } from "../lib/errors.ts";

export const userManagementService = {
    async getMembers(workspaceId: string) {
        return workspaceRepository.getMembersWithDetails(workspaceId);
    },

    async updateMemberRole(
        workspaceId: string,
        targetUserId: string,
        newRole: "admin" | "member",
        requesterId: string
    ) {
        // Only owner can change roles
        await requireOwner(workspaceId, requesterId);

        // Prevent changing owner's own role
        const targetRole = await workspaceRepository.getMemberRole(workspaceId, targetUserId);
        if (targetRole === "owner") {
            throw new ForbiddenError("Cannot change the workspace owner's role");
        }

        if (!targetRole) {
            throw new AppError("User is not a member of this workspace", 404, "NOT_MEMBER");
        }

        return workspaceRepository.updateMemberRole(workspaceId, targetUserId, newRole);
    },

    async removeMember(
        workspaceId: string,
        targetUserId: string,
        requesterId: string
    ) {
        await requireOwnerOrAdmin(workspaceId, requesterId);

        // Prevent removing the owner
        const targetRole = await workspaceRepository.getMemberRole(workspaceId, targetUserId);
        if (targetRole === "owner") {
            throw new ForbiddenError("Cannot remove the workspace owner");
        }

        if (!targetRole) {
            throw new AppError("User is not a member of this workspace", 404, "NOT_MEMBER");
        }

        // Prevent self-removal for admins (owner can remove admins)
        if (targetUserId === requesterId) {
            throw new ForbiddenError("You cannot remove yourself from the workspace");
        }

        // Clean up user-specific data
        await userCreditLimitRepository.delete(workspaceId, targetUserId);
        await userAgentAccessRepository.deleteByUser(workspaceId, targetUserId);
        await workspaceRepository.removeMember(workspaceId, targetUserId);
    },

    async setUserCreditLimit(
        workspaceId: string,
        targetUserId: string,
        creditLimit: number,
        periodEnd: Date | null | undefined,
        requesterId: string
    ) {
        await requireOwnerOrAdmin(workspaceId, requesterId);

        // Verify target is a member
        const role = await workspaceRepository.getMemberRole(workspaceId, targetUserId);
        if (!role) {
            throw new AppError("User is not a member of this workspace", 404, "NOT_MEMBER");
        }

        return userCreditLimitRepository.upsert({
            workspaceId,
            userId: targetUserId,
            creditLimit,
            periodEnd,
        });
    },

    async resetUserCredits(
        workspaceId: string,
        targetUserId: string,
        requesterId: string
    ) {
        await requireOwnerOrAdmin(workspaceId, requesterId);
        return userCreditLimitRepository.resetUsed(workspaceId, targetUserId);
    },

    async removeUserCreditLimit(
        workspaceId: string,
        targetUserId: string,
        requesterId: string
    ) {
        await requireOwnerOrAdmin(workspaceId, requesterId);
        await userCreditLimitRepository.delete(workspaceId, targetUserId);
    },

    async setUserAgentAccess(
        workspaceId: string,
        targetUserId: string,
        agentAccess: { agentId: string; allowed: boolean }[],
        requesterId: string
    ) {
        await requireOwnerOrAdmin(workspaceId, requesterId);

        // Verify target is a member
        const role = await workspaceRepository.getMemberRole(workspaceId, targetUserId);
        if (!role) {
            throw new AppError("User is not a member of this workspace", 404, "NOT_MEMBER");
        }

        return userAgentAccessRepository.bulkSetAccess(
            workspaceId,
            targetUserId,
            agentAccess
        );
    },

    async getUserAgentAccess(workspaceId: string, targetUserId: string) {
        return userAgentAccessRepository.findByUser(workspaceId, targetUserId);
    },
};
