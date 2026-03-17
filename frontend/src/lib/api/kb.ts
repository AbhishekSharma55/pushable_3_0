import { apiClient } from './client';
import type { KnowledgeBase, KBDocument, KBChunk } from '@/types';

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

export const getChunksByDocument = (workspaceId: string, kbId: string, documentId: string): Promise<KBChunk[]> =>
    apiClient.get(`/api/kb/${kbId}/documents/${documentId}/chunks`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getChunksByKB = (workspaceId: string, kbId: string): Promise<KBChunk[]> =>
    apiClient.get(`/api/kb/${kbId}/chunks`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateChunk = (workspaceId: string, chunkId: string, content: string): Promise<KBChunk> =>
    apiClient.put(`/api/kb/chunks/${chunkId}`, { content }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteChunk = (workspaceId: string, chunkId: string) =>
    apiClient.delete(`/api/kb/chunks/${chunkId}`, { headers: { 'x-workspace-id': workspaceId } });

export const addManualChunk = (workspaceId: string, kbId: string, documentId: string, content: string): Promise<KBChunk> =>
    apiClient.post(`/api/kb/${kbId}/documents/${documentId}/chunks`, { content }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
