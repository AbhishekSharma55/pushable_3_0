import { apiClient } from './client';
import type { Workflow, WorkflowRun, WorkflowStats } from '@/types';

export interface CreateWorkflowInput {
    agentId: string;
    name: string;
    description?: string;
    inputSchema?: Record<string, { type: 'string' | 'number' | 'boolean'; description: string; required?: boolean; default?: string | number | boolean }>;
    recipe?: { version: 1; steps: unknown[]; outputTemplate?: string };
    sourceSessionId?: string;
    enabled?: boolean;
}

export const getWorkflows = (workspaceId: string): Promise<Workflow[]> =>
    apiClient.get('/api/workflows', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getWorkflow = (workspaceId: string, id: string): Promise<Workflow> =>
    apiClient.get(`/api/workflows/${id}`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createWorkflow = (workspaceId: string, data: CreateWorkflowInput): Promise<Workflow> =>
    apiClient.post('/api/workflows', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateWorkflow = (workspaceId: string, id: string, data: Partial<CreateWorkflowInput>): Promise<Workflow> =>
    apiClient.put(`/api/workflows/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteWorkflow = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/workflows/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const compileWorkflow = (workspaceId: string, sessionId: string, agentId: string, userHint?: string): Promise<Workflow> =>
    apiClient.post('/api/workflows/compile', { sessionId, agentId, userHint }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const runWorkflow = (workspaceId: string, id: string, inputData: Record<string, unknown> = {}): Promise<WorkflowRun> =>
    apiClient.post(`/api/workflows/${id}/run`, { inputData }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getWorkflowRuns = (workspaceId: string, workflowId: string, limit = 50, offset = 0): Promise<WorkflowRun[]> =>
    apiClient.get(`/api/workflows/${workflowId}/runs`, { params: { limit, offset }, headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getWorkflowStats = (workspaceId: string, workflowId: string): Promise<WorkflowStats> =>
    apiClient.get(`/api/workflows/${workflowId}/stats`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
