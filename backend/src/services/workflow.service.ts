import { workflowRepository } from "../repositories/workflow.repository.ts";
import { NotFoundError } from "../lib/errors.ts";
import { workflowQueue } from "../lib/queue.ts";

export const workflowService = {
    async createWorkflow(data: { name: string }, workspaceId: string) {
        return workflowRepository.create({ ...data, workspaceId });
    },

    async getWorkflows(workspaceId: string) {
        return workflowRepository.findByWorkspace(workspaceId);
    },

    async getWorkflow(id: string, workspaceId: string) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        const steps = await workflowRepository.getSteps(id, workspaceId);
        return { ...workflow, steps };
    },

    async updateWorkflow(
        id: string,
        workspaceId: string,
        data: Partial<{ name: string }>
    ) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        return workflowRepository.update(id, workspaceId, data);
    },

    async deleteWorkflow(id: string, workspaceId: string) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        await workflowRepository.delete(id, workspaceId);
    },

    async addStep(workflowId: string, taskId: string, workspaceId: string) {
        const workflow = await workflowRepository.findById(
            workflowId,
            workspaceId
        );
        if (!workflow) throw new NotFoundError("Workflow not found");
        const steps = await workflowRepository.getSteps(
            workflowId,
            workspaceId
        );
        const nextOrder = steps.length > 0
            ? Math.max(...steps.map((s) => s.order)) + 1
            : 0;
        return workflowRepository.addStep({
            workspaceId,
            workflowId,
            taskId,
            order: nextOrder,
        });
    },

    async reorderSteps(
        workflowId: string,
        workspaceId: string,
        steps: { id: string; order: number }[]
    ) {
        const workflow = await workflowRepository.findById(
            workflowId,
            workspaceId
        );
        if (!workflow) throw new NotFoundError("Workflow not found");
        await workflowRepository.updateStepOrder(steps);
    },

    async removeStep(
        stepId: string,
        workflowId: string,
        workspaceId: string
    ) {
        const workflow = await workflowRepository.findById(
            workflowId,
            workspaceId
        );
        if (!workflow) throw new NotFoundError("Workflow not found");
        await workflowRepository.deleteStep(stepId, workflowId);
    },

    async runWorkflow(id: string, workspaceId: string) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        await workflowQueue.add(`workflow-${id}`, {
            workflowId: id,
            workspaceId,
        });
    },
};
