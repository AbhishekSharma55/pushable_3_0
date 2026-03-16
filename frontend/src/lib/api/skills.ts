import { apiClient } from './client';
import type { Skill } from '@/types';

export interface CreateSkillInput {
    name: string;
    description?: string;
    origin?: string;
    instructions: string;
}

export const getSkills = (workspaceId: string): Promise<Skill[]> =>
    apiClient.get('/api/skills', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createSkill = (workspaceId: string, data: CreateSkillInput): Promise<Skill> =>
    apiClient.post('/api/skills', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateSkill = (workspaceId: string, id: string, data: Partial<CreateSkillInput>): Promise<Skill> =>
    apiClient.put(`/api/skills/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteSkill = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/skills/${id}`, { headers: { 'x-workspace-id': workspaceId } });
