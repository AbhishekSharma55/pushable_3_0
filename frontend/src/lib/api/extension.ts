import { apiClient } from './client';
import { API_URL } from '@/lib/constants';

export interface ExtensionSettings {
    wsUrl: string;
    apiKey: string;
}

export const getExtensionSettings = (workspaceId: string): Promise<ExtensionSettings> =>
    apiClient.get(`/api/workspaces/${workspaceId}/extension-settings`).then((r) => r.data.data);

export const regenerateExtensionApiKey = (workspaceId: string): Promise<{ apiKey: string }> =>
    apiClient
        .post(`/api/workspaces/${workspaceId}/extension-settings/regenerate`)
        .then((r) => r.data.data);

export const getExtensionDownloadUrl = (): string =>
    `${API_URL}/api/extension/download`;
