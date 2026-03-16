import { apiClient } from './client';
import type { Tool } from '@/types';

export interface CreateToolInput {
    name: string;
    description?: string;
    type: 'mcp' | 'function';
    config: Record<string, unknown>;
    isGlobal?: boolean;
}

export const getTools = (workspaceId: string): Promise<Tool[]> =>
    apiClient.get('/api/tools', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createTool = (workspaceId: string, data: CreateToolInput): Promise<Tool> =>
    apiClient.post('/api/tools', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateTool = (workspaceId: string, id: string, data: Partial<CreateToolInput>): Promise<Tool> =>
    apiClient.put(`/api/tools/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteTool = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/tools/${id}`, { headers: { 'x-workspace-id': workspaceId } });
