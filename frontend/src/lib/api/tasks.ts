import { apiClient } from './client';
import type { Task } from '@/types';

export interface CreateTaskInput {
    agentId: string;
    title: string;
    description?: string;
}

export const getTasks = (workspaceId: string): Promise<Task[]> =>
    apiClient.get('/api/tasks', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getTask = (workspaceId: string, id: string): Promise<Task> =>
    apiClient.get(`/api/tasks/${id}`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createTask = (workspaceId: string, data: CreateTaskInput): Promise<Task> =>
    apiClient.post('/api/tasks', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateTask = (workspaceId: string, id: string, data: Partial<CreateTaskInput>): Promise<Task> =>
    apiClient.put(`/api/tasks/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteTask = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/tasks/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const runTask = (workspaceId: string, id: string) =>
    apiClient.post(`/api/tasks/${id}/run`, {}, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
