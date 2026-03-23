import { apiClient } from './client';

export const getSessions = (workspaceId: string, agentId: string) =>
    apiClient.get(`/api/agents/${agentId}/sessions`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getAllSessions = (workspaceId: string) =>
    apiClient.get('/api/sessions', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createSession = (workspaceId: string, agentId: string, title: string) =>
    apiClient.post(`/api/agents/${agentId}/sessions`, { title }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteSession = (workspaceId: string, agentId: string, sessionId: string) =>
    apiClient.delete(`/api/agents/${agentId}/sessions/${sessionId}`, { headers: { 'x-workspace-id': workspaceId } });

export const getMessages = (workspaceId: string, sessionId: string) =>
    apiClient.get(`/api/sessions/${sessionId}/messages`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const sendChat = (workspaceId: string, sessionId: string, message: string) =>
    apiClient.post(`/api/sessions/${sessionId}/chat`, { message }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data);

export const getActiveRun = (workspaceId: string, sessionId: string) =>
    apiClient.get(`/api/sessions/${sessionId}/active-run`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const approveRun = (workspaceId: string, runId: string, decisions: Array<{ type: string; args?: Record<string, unknown>; message?: string }>) =>
    apiClient.post(`/api/runs/${runId}/approve`, { decisions }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data);

export const getBrowserSession = (workspaceId: string, sessionId: string): Promise<{ sessionId: string; status: string } | null> =>
    apiClient.get(`/api/sessions/${sessionId}/browser-session`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
