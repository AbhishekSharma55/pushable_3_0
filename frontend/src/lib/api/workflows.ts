import { apiClient } from './client';
import type { Workflow, WorkflowStep } from '@/types';

export const getWorkflows = (workspaceId: string): Promise<Workflow[]> =>
    apiClient.get('/api/workflows', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getWorkflow = (workspaceId: string, id: string): Promise<Workflow & { steps: WorkflowStep[] }> =>
    apiClient.get(`/api/workflows/${id}`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createWorkflow = (workspaceId: string, data: { name: string }): Promise<Workflow> =>
    apiClient.post('/api/workflows', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateWorkflow = (workspaceId: string, id: string, data: { name?: string }): Promise<Workflow> =>
    apiClient.put(`/api/workflows/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteWorkflow = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/workflows/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const addStep = (workspaceId: string, workflowId: string, taskId: string): Promise<WorkflowStep> =>
    apiClient.post(`/api/workflows/${workflowId}/steps`, { taskId }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const removeStep = (workspaceId: string, workflowId: string, stepId: string) =>
    apiClient.delete(`/api/workflows/${workflowId}/steps/${stepId}`, { headers: { 'x-workspace-id': workspaceId } });

export const reorderSteps = (workspaceId: string, workflowId: string, steps: { id: string; order: number }[]) =>
    apiClient.put(`/api/workflows/${workflowId}/steps/reorder`, { steps }, { headers: { 'x-workspace-id': workspaceId } });

export const runWorkflow = (workspaceId: string, id: string) =>
    apiClient.post(`/api/workflows/${id}/run`, {}, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
