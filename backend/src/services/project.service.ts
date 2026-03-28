import { projectRepository } from "../repositories/project.repository.ts";
import { milestoneRepository } from "../repositories/milestone.repository.ts";
import { AppError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export const projectService = {
    async create(data: {
        workspaceId: string;
        name: string;
        description?: string;
        instructions?: string;
        createdBy?: string;
    }) {
        const project = await projectRepository.create(data);
        logger.info({ projectId: project.id, name: project.name }, "Project created");
        return project;
    },

    async getById(id: string, workspaceId: string) {
        const project = await projectRepository.findById(id, workspaceId);
        if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
        return project;
    },

    async getByIdWithDetails(id: string, workspaceId: string) {
        const project = await projectRepository.findByIdWithDetails(id, workspaceId);
        if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
        return project;
    },

    async list(workspaceId: string) {
        return projectRepository.findByWorkspace(workspaceId);
    },

    async update(id: string, workspaceId: string, data: Partial<{
        name: string;
        description: string;
        instructions: string;
        status: string;
    }>) {
        const project = await projectRepository.update(id, workspaceId, data);
        if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
        return project;
    },

    async delete(id: string, workspaceId: string) {
        const project = await projectRepository.delete(id, workspaceId);
        if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
        logger.info({ projectId: id }, "Project deleted");
        return project;
    },

    async assignAgent(projectId: string, agentId: string, workspaceId: string, roleInProject?: string) {
        await this.getById(projectId, workspaceId);
        return projectRepository.assignAgent(projectId, agentId, workspaceId, roleInProject);
    },

    async removeAgent(projectId: string, agentId: string, workspaceId: string) {
        return projectRepository.removeAgent(projectId, agentId, workspaceId);
    },

    async getAgents(projectId: string, workspaceId: string) {
        return projectRepository.getAgents(projectId, workspaceId);
    },

    async assignKB(projectId: string, kbId: string, workspaceId: string) {
        await this.getById(projectId, workspaceId);
        return projectRepository.assignKB(projectId, kbId, workspaceId);
    },

    async removeKB(projectId: string, kbId: string, workspaceId: string) {
        return projectRepository.removeKB(projectId, kbId, workspaceId);
    },

    async getKBs(projectId: string, workspaceId: string) {
        return projectRepository.getKBs(projectId, workspaceId);
    },

    // Milestones
    async createMilestone(data: {
        projectId: string;
        workspaceId: string;
        title: string;
        description?: string;
        targetDate?: Date;
        sortOrder?: number;
    }) {
        await this.getById(data.projectId, data.workspaceId);
        return milestoneRepository.create(data);
    },

    async updateMilestone(id: string, workspaceId: string, data: Partial<{
        title: string;
        description: string;
        status: string;
        targetDate: Date;
        completedAt: Date;
        evaluationNotes: string;
        sortOrder: number;
    }>) {
        const milestone = await milestoneRepository.update(id, workspaceId, data);
        if (!milestone) throw new AppError("Milestone not found", 404, "MILESTONE_NOT_FOUND");
        return milestone;
    },

    async deleteMilestone(id: string, workspaceId: string) {
        const milestone = await milestoneRepository.delete(id, workspaceId);
        if (!milestone) throw new AppError("Milestone not found", 404, "MILESTONE_NOT_FOUND");
        return milestone;
    },

    async getMilestones(projectId: string, workspaceId: string) {
        return milestoneRepository.findByProject(projectId, workspaceId);
    },

    async getProjectsForAgent(agentId: string, workspaceId: string) {
        return projectRepository.getProjectsForAgent(agentId, workspaceId);
    },
};
