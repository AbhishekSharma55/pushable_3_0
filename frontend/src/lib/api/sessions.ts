import { apiClient } from './client';

export const getSessions = (workspaceId: string, agentId: string) =>
    apiClient.get(`/api/agents/${agentId}/sessions`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createSession = (workspaceId: string, agentId: string, title: string) =>
    apiClient.post(`/api/agents/${agentId}/sessions`, { title }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteSession = (workspaceId: string, agentId: string, sessionId: string) =>
    apiClient.delete(`/api/agents/${agentId}/sessions/${sessionId}`, { headers: { 'x-workspace-id': workspaceId } });

export const getMessages = (workspaceId: string, sessionId: string) =>
    apiClient.get(`/api/sessions/${sessionId}/messages`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
