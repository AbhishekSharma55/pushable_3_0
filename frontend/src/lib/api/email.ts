import { apiClient } from './client';

// Types
export interface EmailWorkspaceAddress {
    id: string;
    workspaceId: string;
    address: string;
    displayName: string | null;
    customInstructions: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EmailApprovedSender {
    id: string;
    workspaceId: string;
    senderPattern: string;
    note: string | null;
    createdAt: string;
}

export type EmailStatus =
    | 'received'
    | 'routing'
    | 'processing'
    | 'awaiting_approval'
    | 'approved'
    | 'rejected'
    | 'completed'
    | 'failed'
    | 'spam';

export interface InboundEmail {
    id: string;
    workspaceId: string;
    emailAddressId: string | null;
    sessionId: string | null;
    fromAddress: string;
    fromName: string | null;
    toAddress: string;
    subject: string | null;
    bodyText: string | null;
    bodyHtml: string | null;
    cc: string | null;
    messageId: string | null;
    inReplyTo: string | null;
    references: string | null;
    status: EmailStatus;
    routedToAgentId: string | null;
    statusHistory: Array<{
        status: string;
        timestamp: string;
        detail: string;
    }>;
    replySent: boolean;
    replyContent: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface InboxPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// Email address management
export const getEmailAddress = (workspaceId: string): Promise<EmailWorkspaceAddress | null> =>
    apiClient.get('/api/email/address', { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const createEmailAddress = (
    workspaceId: string,
    data: { address: string; displayName?: string; customInstructions?: string }
): Promise<EmailWorkspaceAddress> =>
    apiClient.post('/api/email/address', data, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const updateEmailAddress = (
    workspaceId: string,
    data: Partial<{ address: string; displayName: string | null; customInstructions: string | null; enabled: boolean }>
): Promise<EmailWorkspaceAddress> =>
    apiClient.put('/api/email/address', data, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const deleteEmailAddress = (workspaceId: string): Promise<void> =>
    apiClient.delete('/api/email/address', { headers: { 'x-workspace-id': workspaceId } });

export const regenerateEmailAddress = (workspaceId: string): Promise<EmailWorkspaceAddress> =>
    apiClient.post('/api/email/address/regenerate', {}, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const generateEmailAddress = (workspaceId: string): Promise<EmailWorkspaceAddress> =>
    apiClient.post('/api/email/address/generate', {}, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

// Approved senders
export const getApprovedSenders = (workspaceId: string): Promise<EmailApprovedSender[]> =>
    apiClient.get('/api/email/approved-senders', { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const addApprovedSender = (
    workspaceId: string,
    data: { senderPattern: string; note?: string }
): Promise<EmailApprovedSender> =>
    apiClient.post('/api/email/approved-senders', data, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const removeApprovedSender = (workspaceId: string, id: string): Promise<void> =>
    apiClient.delete(`/api/email/approved-senders/${id}`, { headers: { 'x-workspace-id': workspaceId } });

// Inbox
export const getInbox = (
    workspaceId: string,
    params?: { status?: EmailStatus; page?: number; limit?: number }
): Promise<{ data: InboundEmail[]; pagination: InboxPagination }> =>
    apiClient.get('/api/email/inbox', {
        headers: { 'x-workspace-id': workspaceId },
        params,
    }).then(r => r.data);

export const getEmailDetail = (workspaceId: string, id: string): Promise<InboundEmail> =>
    apiClient.get(`/api/email/inbox/${id}`, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => r.data.data);

export const approveEmail = (workspaceId: string, id: string): Promise<void> =>
    apiClient.post(`/api/email/inbox/${id}/approve`, {}, { headers: { 'x-workspace-id': workspaceId } });

export const rejectEmail = (workspaceId: string, id: string): Promise<void> =>
    apiClient.post(`/api/email/inbox/${id}/reject`, {}, { headers: { 'x-workspace-id': workspaceId } });
