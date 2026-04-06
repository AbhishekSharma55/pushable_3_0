import { apiClient } from './client';
import type { WhatsAppUserLink } from '@/types';

export interface WhatsAppStatus {
    available: boolean;
    links: WhatsAppUserLink[];
}

export interface WhatsAppLinkResult {
    code: string;
    expiresInSeconds: number;
}

export interface WhatsAppLinkStatus {
    verified: boolean;
    whatsappPhone?: string;
    whatsappName?: string;
}

export const getWhatsAppStatus = (workspaceId: string): Promise<WhatsAppStatus> =>
    apiClient.get('/api/whatsapp/status', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const initiateWhatsAppLink = (workspaceId: string): Promise<WhatsAppLinkResult> =>
    apiClient.post('/api/whatsapp/link', {}, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const checkWhatsAppLinkStatus = (workspaceId: string): Promise<WhatsAppLinkStatus> =>
    apiClient.get('/api/whatsapp/link-status', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const unlinkWhatsApp = (workspaceId: string, linkId: string) =>
    apiClient.delete(`/api/whatsapp/links/${linkId}`, { headers: { 'x-workspace-id': workspaceId } });
