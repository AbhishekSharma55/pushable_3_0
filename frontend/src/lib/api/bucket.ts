import { apiClient } from './client';
import { API_URL } from '@/lib/constants';
import type { BucketFile } from '@/types';

export const listFiles = (workspaceId: string, params?: { folder?: string; source?: string; search?: string; limit?: number; offset?: number }): Promise<BucketFile[]> =>
    apiClient.get('/api/bucket/files', {
        headers: { 'x-workspace-id': workspaceId },
        params,
    }).then(r => r.data.data);

export const getFile = (workspaceId: string, id: string): Promise<BucketFile> =>
    apiClient.get(`/api/bucket/files/${id}`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const uploadFile = (workspaceId: string, file: File, folder?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (folder) formData.append('folder', folder);
    return apiClient.post('/api/bucket/files/upload', formData, {
        headers: { 'x-workspace-id': workspaceId, 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
    }).then(r => r.data.data);
};

export const deleteFile = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/bucket/files/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const renameFile = (workspaceId: string, id: string, filename: string) =>
    apiClient.put(`/api/bucket/files/${id}`, { filename }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const moveFile = (workspaceId: string, id: string, folder: string) =>
    apiClient.put(`/api/bucket/files/${id}`, { folder }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const listFolders = (workspaceId: string): Promise<string[]> =>
    apiClient.get('/api/bucket/folders', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createFolder = (workspaceId: string, path: string) =>
    apiClient.post('/api/bucket/folders', { path }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getStorageUsage = (workspaceId: string): Promise<{ totalBytes: number; fileCount: number; limitBytes: number; usedPercent: number }> =>
    apiClient.get('/api/bucket/usage', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getFileDownloadUrl = (id: string): string =>
    `${API_URL}/api/bucket/files/${id}/download`;
