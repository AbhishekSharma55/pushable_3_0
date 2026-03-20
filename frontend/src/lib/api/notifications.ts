import { apiClient } from './client';

export interface PendingNotification {
    id: string;
    type: 'approval';
    runId: string;
    sessionId: string;
    agentId: string;
    agentName: string;
    sessionTitle: string;
    approvalRequest: unknown;
    createdAt: string;
    updatedAt: string;
}

export const getPendingNotifications = (workspaceId: string): Promise<PendingNotification[]> =>
    apiClient.get('/api/notifications/pending', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
