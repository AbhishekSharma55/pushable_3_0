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

export const sendChat = (workspaceId: string, sessionId: string, message: string, files?: File[]) => {
    if (files && files.length > 0) {
        const formData = new FormData();
        formData.append('message', message);
        for (const file of files) {
            formData.append('files', file);
        }
        return apiClient.post(`/api/sessions/${sessionId}/chat`, formData, {
            headers: { 'x-workspace-id': workspaceId, 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
        }).then(r => r.data);
    }
    return apiClient.post(`/api/sessions/${sessionId}/chat`, { message }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data);
};

export const getActiveRun = (workspaceId: string, sessionId: string) =>
    apiClient.get(`/api/sessions/${sessionId}/active-run`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const approveRun = (workspaceId: string, runId: string, decisions: Array<{ type: string; args?: Record<string, unknown>; message?: string }>) =>
    apiClient.post(`/api/runs/${runId}/approve`, { decisions }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data);

export const getBrowserSession = (workspaceId: string, sessionId: string): Promise<{ sessionId: string; status: string } | null> =>
    apiClient.get(`/api/sessions/${sessionId}/browser-session`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getModelCapabilities = (workspaceId: string, modelId: string): Promise<{ supportsVision: boolean; inputModalities: string[] }> =>
    apiClient.get(`/api/llm/models/${encodeURIComponent(modelId)}/capabilities`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
