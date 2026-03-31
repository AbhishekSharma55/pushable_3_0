import { apiClient } from './client';
import type { TestSuite, TestStats } from '@/types';

const h = (workspaceId: string) => ({ headers: { 'x-workspace-id': workspaceId } });

export const getTesterAgent = (workspaceId: string) =>
    apiClient.get('/api/agents/tester', h(workspaceId)).then(r => r.data.data);

export const listTestSuites = (workspaceId: string, agentId?: string): Promise<TestSuite[]> =>
    apiClient.get('/api/testing/suites', { ...h(workspaceId), params: { agentId } }).then(r => r.data.data);

export const getTestSuite = (workspaceId: string, id: string): Promise<TestSuite> =>
    apiClient.get(`/api/testing/suites/${id}`, h(workspaceId)).then(r => r.data.data);

export const deleteTestSuite = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/testing/suites/${id}`, h(workspaceId));

export const getAgentTestStats = (workspaceId: string, agentId: string): Promise<TestStats> =>
    apiClient.get(`/api/testing/agents/${agentId}/stats`, h(workspaceId)).then(r => r.data.data);
