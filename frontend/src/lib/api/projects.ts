import { apiClient } from './client';
import type { Project, ProjectMilestone, ProjectAgent, ProjectKB, RunReport } from '@/types';

const h = (workspaceId: string) => ({ headers: { 'x-workspace-id': workspaceId } });

export const listProjects = (workspaceId: string): Promise<Project[]> =>
    apiClient.get('/api/projects', h(workspaceId)).then(r => r.data.data);

export const getProject = (workspaceId: string, id: string): Promise<Project> =>
    apiClient.get(`/api/projects/${id}`, h(workspaceId)).then(r => r.data.data);

export const createProject = (workspaceId: string, data: { name: string; description?: string; instructions?: string }): Promise<Project> =>
    apiClient.post('/api/projects', data, h(workspaceId)).then(r => r.data.data);

export const updateProject = (workspaceId: string, id: string, data: { name?: string; description?: string; instructions?: string; status?: string }): Promise<Project> =>
    apiClient.put(`/api/projects/${id}`, data, h(workspaceId)).then(r => r.data.data);

export const deleteProject = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/projects/${id}`, h(workspaceId));

// Agent assignments
export const assignAgentToProject = (workspaceId: string, projectId: string, agentId: string, roleInProject?: string): Promise<ProjectAgent> =>
    apiClient.post(`/api/projects/${projectId}/agents`, { agentId, roleInProject }, h(workspaceId)).then(r => r.data.data);

export const removeAgentFromProject = (workspaceId: string, projectId: string, agentId: string) =>
    apiClient.delete(`/api/projects/${projectId}/agents/${agentId}`, h(workspaceId));

// Milestones
export const createMilestone = (workspaceId: string, projectId: string, data: { title: string; description?: string; targetDate?: string }): Promise<ProjectMilestone> =>
    apiClient.post(`/api/projects/${projectId}/milestones`, data, h(workspaceId)).then(r => r.data.data);

export const updateMilestone = (workspaceId: string, projectId: string, milestoneId: string, data: { title?: string; description?: string; status?: string; targetDate?: string; evaluationNotes?: string; sortOrder?: number }): Promise<ProjectMilestone> =>
    apiClient.put(`/api/projects/${projectId}/milestones/${milestoneId}`, data, h(workspaceId)).then(r => r.data.data);

export const deleteMilestone = (workspaceId: string, projectId: string, milestoneId: string) =>
    apiClient.delete(`/api/projects/${projectId}/milestones/${milestoneId}`, h(workspaceId));

// KB assignments
export const assignKBToProject = (workspaceId: string, projectId: string, kbId: string): Promise<ProjectKB> =>
    apiClient.post(`/api/projects/${projectId}/kb`, { kbId }, h(workspaceId)).then(r => r.data.data);

export const removeKBFromProject = (workspaceId: string, projectId: string, kbId: string) =>
    apiClient.delete(`/api/projects/${projectId}/kb/${kbId}`, h(workspaceId));

// Reports
export const getProjectReports = (workspaceId: string, projectId: string, since?: string): Promise<RunReport[]> =>
    apiClient.get(`/api/projects/${projectId}/reports`, { ...h(workspaceId), params: { since } }).then(r => r.data.data);

// CEO
export const getCEOAgent = (workspaceId: string) =>
    apiClient.get('/api/agents/ceo', h(workspaceId)).then(r => r.data.data);
