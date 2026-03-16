import { apiClient } from './client';
import type { AgentPermission } from '@/types';

export interface SetPermissionInput {
    resourceType: 'tool' | 'kb' | 'skill';
    resourceId: string;
    allowed: boolean;
}

export const getAgentPermissions = (workspaceId: string, agentId: string): Promise<AgentPermission[]> =>
    apiClient.get(`/api/agents/${agentId}/permissions`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const setAgentPermissions = (workspaceId: string, agentId: string, permissions: SetPermissionInput[]): Promise<AgentPermission[]> =>
    apiClient.post(`/api/agents/${agentId}/permissions`, { permissions }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
