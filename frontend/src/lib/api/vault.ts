import { apiClient } from './client';

export interface VaultStatus {
    connected: boolean;
    id?: string;
    provider?: string;
    status?: 'active' | 'inactive' | 'failed';
    createdAt?: string;
}

export interface VaultConnectPayload {
    provider: 'bitwarden';
    clientId: string;
    clientSecret: string;
    masterPassword: string;
}

export const getVaultStatus = (workspaceId: string): Promise<VaultStatus> =>
    apiClient
        .get('/api/vault/status', {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

export const connectVault = (
    workspaceId: string,
    payload: VaultConnectPayload
): Promise<{ id: string; provider: string; status: string }> =>
    apiClient
        .post('/api/vault/connect', payload, {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

export const testVault = (
    workspaceId: string
): Promise<{ success: boolean; error?: string }> =>
    apiClient
        .post(
            '/api/vault/test',
            {},
            { headers: { 'x-workspace-id': workspaceId } }
        )
        .then((r) => r.data.data);

export const disconnectVault = (workspaceId: string) =>
    apiClient.delete('/api/vault/disconnect', {
        headers: { 'x-workspace-id': workspaceId },
    });

