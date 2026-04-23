import { apiClient } from './client';
import type { SlackUserLink } from '@/types';

export interface SlackStatus {
    available: boolean;
    installUrl: string | null;
    links: SlackUserLink[];
}

export interface SlackLinkResult {
    code: string;
    installUrl: string | null;
    expiresInSeconds: number;
}

export interface SlackLinkStatus {
    verified: boolean;
    slackUsername?: string;
    slackDisplayName?: string;
}

export const getSlackStatus = (workspaceId: string): Promise<SlackStatus> =>
    apiClient.get('/api/slack/status', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const initiateSlackLink = (workspaceId: string): Promise<SlackLinkResult> =>
    apiClient.post('/api/slack/link', {}, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const checkSlackLinkStatus = (workspaceId: string): Promise<SlackLinkStatus> =>
    apiClient.get('/api/slack/link-status', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const unlinkSlack = (workspaceId: string, linkId: string) =>
    apiClient.delete(`/api/slack/links/${linkId}`, { headers: { 'x-workspace-id': workspaceId } });
