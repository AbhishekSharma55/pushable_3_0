import { apiClient } from './client';
import type { SystemPermissionsInput } from '@/types';

export interface CreateAgentInput {
    name: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    browserType?: 'cloud' | 'extension';
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
    browserType?: 'cloud' | 'extension';
    browserProxyId?: string | null;
}

export const getAgents = (workspaceId: string) =>
    apiClient.get('/api/agents', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createAgent = (workspaceId: string, data: CreateAgentInput) =>
    apiClient.post('/api/agents', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateAgent = (workspaceId: string, id: string, data: UpdateAgentInput) =>
    apiClient.put(`/api/agents/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteAgent = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/agents/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const updateSystemPermissions = (workspaceId: string, id: string, data: SystemPermissionsInput) =>
    apiClient.put(`/api/agents/${id}/system-permissions`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
