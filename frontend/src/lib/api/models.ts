import { apiClient } from './client';
import type { LLMModel } from '@/types';

export const getModels = (workspaceId: string): Promise<LLMModel[]> =>
    apiClient.get('/api/models', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getAllModels = (workspaceId: string): Promise<LLMModel[]> =>
    apiClient.get('/api/models/all', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
