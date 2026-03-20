import { apiClient } from './client';
import type { Integration, Toolkit } from '@/types';

export const getToolkits = (options?: {
    search?: string;
    cursor?: string;
    limit?: number;
}): Promise<{ items: Toolkit[]; nextCursor: string | null }> => {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get(`/api/integrations/toolkits${qs}`).then(r => ({
        items: r.data.data,
        nextCursor: r.data.nextCursor ?? null,
    }));
};

export const getIntegrations = (workspaceId: string): Promise<Integration[]> =>
    apiClient.get('/api/integrations', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const connectIntegration = (
    workspaceId: string,
    data: {
        toolkitSlug: string;
        name: string;
        connectionLabel: string;
        connectionDescription?: string;
        logo?: string;
    }
): Promise<{ connectionUrl: string; integrationId: string }> =>
    apiClient.post('/api/integrations/connect', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateIntegration = (
    workspaceId: string,
    id: string,
    data: { connectionLabel?: string; connectionDescription?: string }
): Promise<Integration> =>
    apiClient.put(`/api/integrations/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const pollIntegrationStatus = (workspaceId: string, id: string): Promise<{ status: string }> =>
    apiClient.get(`/api/integrations/${id}/status`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const handleIntegrationCallback = (
    workspaceId: string,
    connectedAccountId: string,
    status: string
): Promise<{ status: string; integrationId?: string }> =>
    apiClient.post('/api/integrations/callback', { connectedAccountId, status }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteIntegration = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/integrations/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const assignToAgent = (workspaceId: string, agentId: string, integrationId: string) =>
    apiClient.post(`/api/agents/${agentId}/integrations/${integrationId}`, {}, { headers: { 'x-workspace-id': workspaceId } });

export const removeFromAgent = (workspaceId: string, agentId: string, integrationId: string) =>
    apiClient.delete(`/api/agents/${agentId}/integrations/${integrationId}`, { headers: { 'x-workspace-id': workspaceId } });

export const getAgentIntegrations = (workspaceId: string, agentId: string): Promise<Integration[]> =>
    apiClient.get(`/api/agents/${agentId}/integrations`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export interface ToolkitAction {
    slug: string;
    name: string;
    description: string;
    tags: string[];
}

export interface ToolPermissions {
    mode: 'allowlist' | 'blocklist';
    tools: string[];
}

export const getToolkitActions = (slug: string): Promise<ToolkitAction[]> =>
    apiClient.get(`/api/integrations/toolkits/${slug}/actions`).then(r => r.data.data);

export const updateToolPermissions = (
    workspaceId: string,
    integrationId: string,
    permissions: ToolPermissions
): Promise<Integration> =>
    apiClient.put(
        `/api/integrations/${integrationId}/permissions`,
        permissions,
        { headers: { 'x-workspace-id': workspaceId } }
    ).then(r => r.data.data);
