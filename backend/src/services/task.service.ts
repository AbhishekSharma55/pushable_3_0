import { taskRepository } from "../repositories/task.repository.ts";
import { NotFoundError } from "../lib/errors.ts";
import { taskQueue } from "../lib/queue.ts";

export const taskService = {
    async createTask(
        data: {
            agentId: string;
            title: string;
            description?: string;
        },
        workspaceId: string
    ) {
        return taskRepository.create({ ...data, workspaceId });
    },

    async getTasks(workspaceId: string) {
        return taskRepository.findByWorkspace(workspaceId);
    },

    async getTask(id: string, workspaceId: string) {
        const task = await taskRepository.findById(id, workspaceId);
        if (!task) throw new NotFoundError("Task not found");
        return task;
    },

    async updateTask(
        id: string,
        workspaceId: string,
        data: Partial<{ title: string; description: string; agentId: string }>
    ) {
        const task = await taskRepository.findById(id, workspaceId);
        if (!task) throw new NotFoundError("Task not found");
        return taskRepository.update(id, workspaceId, data);
    },

    async deleteTask(id: string, workspaceId: string) {
        const task = await taskRepository.findById(id, workspaceId);
        if (!task) throw new NotFoundError("Task not found");
        await taskRepository.delete(id, workspaceId);
    },

    async runTask(id: string, workspaceId: string) {
        const task = await taskRepository.findById(id, workspaceId);
        if (!task) throw new NotFoundError("Task not found");
        await taskRepository.updateStatus(id, "pending");
        await taskQueue.add(`task-${id}`, { taskId: id, workspaceId });
    },
};
