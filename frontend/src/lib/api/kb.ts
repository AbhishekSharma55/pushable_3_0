import { apiClient } from './client';
import type { KnowledgeBase, KBDocument } from '@/types';

export interface CreateKBInput {
    name: string;
    description?: string;
}

export const getKBs = (workspaceId: string): Promise<KnowledgeBase[]> =>
    apiClient.get('/api/kb', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createKB = (workspaceId: string, data: CreateKBInput): Promise<KnowledgeBase> =>
    apiClient.post('/api/kb', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateKB = (workspaceId: string, id: string, data: Partial<CreateKBInput>): Promise<KnowledgeBase> =>
    apiClient.put(`/api/kb/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteKB = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/kb/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const getDocuments = (workspaceId: string, kbId: string): Promise<KBDocument[]> =>
    apiClient.get(`/api/kb/${kbId}/documents`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const uploadDocument = (workspaceId: string, kbId: string, file: File): Promise<KBDocument> => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post(`/api/kb/${kbId}/documents/upload`, formData, {
        headers: {
            'x-workspace-id': workspaceId,
            'Content-Type': 'multipart/form-data',
        },
        timeout: 120000, // 2 min for large files
    }).then(r => r.data.data);
};

export const deleteDocument = (workspaceId: string, kbId: string, id: string) =>
    apiClient.delete(`/api/kb/${kbId}/documents/${id}`, { headers: { 'x-workspace-id': workspaceId } });
