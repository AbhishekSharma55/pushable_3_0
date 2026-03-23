import { apiClient } from './client';

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
