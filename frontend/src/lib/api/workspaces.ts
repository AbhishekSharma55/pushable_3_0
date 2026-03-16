import { apiClient } from './client';

export const getWorkspaces = () =>
    apiClient.get('/api/workspaces').then((r) => r.data.data);

export const createWorkspace = (data: { name: string }) =>
    apiClient.post('/api/workspaces', data).then((r) => r.data.data);
