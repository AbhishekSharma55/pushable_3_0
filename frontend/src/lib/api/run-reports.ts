import { apiClient } from './client';
import type { RunReport } from '@/types';

const h = (workspaceId: string) => ({ headers: { 'x-workspace-id': workspaceId } });

export const listRunReports = (workspaceId: string, params?: {
    agentId?: string;
    projectId?: string;
    since?: string;
    limit?: number;
    offset?: number;
}): Promise<RunReport[]> =>
    apiClient.get('/api/run-reports', { ...h(workspaceId), params }).then(r => r.data.data);

export const getRunReport = (workspaceId: string, id: string): Promise<RunReport> =>
    apiClient.get(`/api/run-reports/${id}`, h(workspaceId)).then(r => r.data.data);
