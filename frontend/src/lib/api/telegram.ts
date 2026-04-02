import { apiClient } from './client';
import type { TelegramUserLink } from '@/types';

export interface TelegramStatus {
    available: boolean;
    botUsername: string | null;
    links: TelegramUserLink[];
}

export interface TelegramLinkResult {
    code: string;
    botUsername: string | null;
    botLink: string | null;
    expiresInSeconds: number;
}

export interface TelegramLinkStatus {
    verified: boolean;
    telegramUsername?: string;
    telegramFirstName?: string;
}

export const getTelegramStatus = (workspaceId: string): Promise<TelegramStatus> =>
    apiClient.get('/api/telegram/status', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const initiateTelegramLink = (workspaceId: string): Promise<TelegramLinkResult> =>
    apiClient.post('/api/telegram/link', {}, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const checkTelegramLinkStatus = (workspaceId: string): Promise<TelegramLinkStatus> =>
    apiClient.get('/api/telegram/link-status', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const unlinkTelegram = (workspaceId: string, linkId: string) =>
    apiClient.delete(`/api/telegram/links/${linkId}`, { headers: { 'x-workspace-id': workspaceId } });
