import { skillRepository } from "../repositories/skill.repository.ts";
import { NotFoundError } from "../lib/errors.ts";
import { parseFrontmatter, hasFrontmatter } from "../lib/frontmatter.ts";

/**
 * If instructions contain frontmatter, extract name/description/origin
 * and return the body as instructions.
 */
function parseSkillContent(data: {
    name: string;
    description?: string;
    origin?: string;
    instructions: string;
}): {
    name: string;
    description?: string;
    origin?: string;
    instructions: string;
} {
    if (!hasFrontmatter(data.instructions)) {
        return data;
    }

    const { metadata, body } = parseFrontmatter(data.instructions);

    return {
        name: metadata.name || data.name,
        description: metadata.description || data.description,
        origin: metadata.origin || data.origin,
        instructions: body || data.instructions,
    };
}

export const skillService = {
    async createSkill(
        data: {
            name: string;
            description?: string;
            origin?: string;
            instructions: string;
        },
        workspaceId: string
    ) {
        const parsed = parseSkillContent(data);
        return skillRepository.create({ ...parsed, workspaceId });
    },

    async getSkills(workspaceId: string) {
        return skillRepository.findByWorkspace(workspaceId);
    },

    async getSkill(id: string, workspaceId: string) {
        const skill = await skillRepository.findById(id, workspaceId);
        if (!skill) throw new NotFoundError("Skill not found");
        return skill;
    },

    async updateSkill(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            description: string;
            origin: string;
            instructions: string;
        }>
    ) {
        const skill = await skillRepository.findById(id, workspaceId);
        if (!skill) throw new NotFoundError("Skill not found");

        // If instructions are being updated and contain frontmatter, parse them
        if (data.instructions && hasFrontmatter(data.instructions)) {
            const parsed = parseSkillContent({
                name: data.name || skill.name,
                description: data.description,
                origin: data.origin,
                instructions: data.instructions,
            });
            return skillRepository.update(id, workspaceId, parsed);
        }

        return skillRepository.update(id, workspaceId, data);
    },

    async deleteSkill(id: string, workspaceId: string) {
        const skill = await skillRepository.findById(id, workspaceId);
        if (!skill) throw new NotFoundError("Skill not found");
        await skillRepository.delete(id, workspaceId);
    },
};
