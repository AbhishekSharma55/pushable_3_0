import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { ForbiddenError } from "./errors.ts";

export async function requireOwner(workspaceId: string, userId: string): Promise<void> {
    const role = await workspaceRepository.getMemberRole(workspaceId, userId);
    if (role !== "owner") {
        throw new ForbiddenError("Only the workspace owner can perform this action");
    }
}

export async function requireOwnerOrAdmin(workspaceId: string, userId: string): Promise<void> {
    const role = await workspaceRepository.getMemberRole(workspaceId, userId);
    if (role !== "owner" && role !== "admin") {
        throw new ForbiddenError("Only workspace owners and admins can perform this action");
    }
}

export async function requireMember(workspaceId: string, userId: string): Promise<void> {
    const isMember = await workspaceRepository.isMember(workspaceId, userId);
    if (!isMember) {
        throw new ForbiddenError("You are not a member of this workspace");
    }
}
