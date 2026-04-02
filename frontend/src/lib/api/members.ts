import { apiClient } from './client';
import type {
    MemberWithCredits,
    WorkspaceInvitation,
    UserAgentAccess,
    UserCreditLimit,
    InvitationDetails,
} from '@/types';

// --- Current user info ---

export interface MyMemberInfo {
    role: 'owner' | 'admin' | 'member' | null;
    creditLimit: number | null;
    creditsUsed: number | null;
    creditsRemaining: number | null;
}

export const getMyMemberInfo = (workspaceId: string): Promise<MyMemberInfo> =>
    apiClient
        .get('/api/members/me', { headers: { 'x-workspace-id': workspaceId } })
        .then((r) => r.data.data);

// --- Members ---

export const getMembers = (workspaceId: string): Promise<MemberWithCredits[]> =>
    apiClient
        .get('/api/members', { headers: { 'x-workspace-id': workspaceId } })
        .then((r) => r.data.data);

export const updateMemberRole = (workspaceId: string, userId: string, role: string) =>
    apiClient
        .patch(`/api/members/${userId}/role`, { role }, { headers: { 'x-workspace-id': workspaceId } })
        .then((r) => r.data.data);

export const removeMember = (workspaceId: string, userId: string) =>
    apiClient
        .delete(`/api/members/${userId}`, { headers: { 'x-workspace-id': workspaceId } })
        .then((r) => r.data.data);

// --- Credit Limits ---

export const setUserCreditLimit = (
    workspaceId: string,
    userId: string,
    creditLimit: number,
    periodEnd?: string | null
): Promise<UserCreditLimit> =>
    apiClient
        .put(
            `/api/members/${userId}/credit-limit`,
            { creditLimit, periodEnd },
            { headers: { 'x-workspace-id': workspaceId } }
        )
        .then((r) => r.data.data);

export const removeUserCreditLimit = (workspaceId: string, userId: string) =>
    apiClient
        .delete(`/api/members/${userId}/credit-limit`, {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

export const resetUserCredits = (workspaceId: string, userId: string): Promise<UserCreditLimit> =>
    apiClient
        .post(`/api/members/${userId}/credit-limit/reset`, {}, {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

// --- Agent Access ---

export const getUserAgentAccess = (
    workspaceId: string,
    userId: string
): Promise<UserAgentAccess[]> =>
    apiClient
        .get(`/api/members/${userId}/agent-access`, {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

export const setUserAgentAccess = (
    workspaceId: string,
    userId: string,
    access: { agentId: string; allowed: boolean }[]
) =>
    apiClient
        .put(
            `/api/members/${userId}/agent-access`,
            { access },
            { headers: { 'x-workspace-id': workspaceId } }
        )
        .then((r) => r.data.data);

// --- Invitations ---

export const inviteUser = (
    workspaceId: string,
    email: string,
    role: string = 'member'
): Promise<WorkspaceInvitation> =>
    apiClient
        .post(
            `/api/workspaces/${workspaceId}/invitations`,
            { email, role },
            { headers: { 'x-workspace-id': workspaceId } }
        )
        .then((r) => r.data.data);

export const getInvitations = (workspaceId: string): Promise<WorkspaceInvitation[]> =>
    apiClient
        .get(`/api/workspaces/${workspaceId}/invitations`, {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

export const revokeInvitation = (workspaceId: string, invitationId: string) =>
    apiClient
        .delete(`/api/workspaces/${workspaceId}/invitations/${invitationId}`, {
            headers: { 'x-workspace-id': workspaceId },
        })
        .then((r) => r.data.data);

export const acceptInvitation = (token: string) =>
    apiClient.post('/api/invitations/accept', { token }).then((r) => r.data.data);

export const getInvitationDetails = (token: string): Promise<InvitationDetails> =>
    apiClient.get(`/api/invitations/${token}`).then((r) => r.data.data);

export interface PendingInvite {
    id: string;
    workspaceName: string;
    email: string;
    role: string;
    token: string;
    expiresAt: string;
}

export const getMyPendingInvitations = (): Promise<PendingInvite[]> =>
    apiClient.get('/api/invitations/pending/me').then((r) => r.data.data);
