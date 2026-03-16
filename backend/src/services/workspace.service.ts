import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { ForbiddenError } from "../lib/errors.ts";

function generateSlug(name: string): string {
    const base = name.toLowerCase().replace(/\s+/g, "-");
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${base}-${suffix}`;
}

export const workspaceService = {
    async getWorkspaces(userId: string) {
        return workspaceRepository.findByUserId(userId);
    },

    async createWorkspace(data: { name: string }, userId: string) {
        const slug = generateSlug(data.name);

        const workspace = await workspaceRepository.create({
            name: data.name,
            slug,
            ownerId: userId,
        });

        // Add creator as owner
        await workspaceRepository.addMember({
            workspaceId: workspace.id,
            userId,
            role: "owner",
        });

        // Create credits row
        await workspaceRepository.createCredits(workspace.id);

        return workspace;
    },

    async getWorkspaceById(id: string, userId: string) {
        const isMember = await workspaceRepository.isMember(id, userId);
        if (!isMember) {
            throw new ForbiddenError("You are not a member of this workspace");
        }

        return workspaceRepository.findById(id);
    },
};
