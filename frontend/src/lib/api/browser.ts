import { apiClient } from './client';
import type { BrowserProfile, BrowserSession } from '@/types';

export interface CreateProfileInput {
    name: string;
    assignedAgentId?: string | null;
    os?: 'windows' | 'macos' | 'linux';
}

export const getProfiles = (workspaceId: string): Promise<BrowserProfile[]> =>
    apiClient.get('/api/browser/profiles', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createProfile = (workspaceId: string, data: CreateProfileInput): Promise<BrowserProfile> =>
    apiClient.post('/api/browser/profiles', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateProfile = (
    workspaceId: string,
    id: string,
    data: Partial<CreateProfileInput & { status: 'active' | 'inactive' }>
): Promise<BrowserProfile> =>
    apiClient.put(`/api/browser/profiles/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteProfile = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/browser/profiles/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const startSession = (
    workspaceId: string,
    profileId: string,
    agentId?: string
): Promise<{ sessionId: string; wsUrl: string }> =>
    apiClient.post('/api/browser/sessions/start', { profileId, agentId }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const endSession = (workspaceId: string, sessionId: string) =>
    apiClient.delete(`/api/browser/sessions/${sessionId}`, { headers: { 'x-workspace-id': workspaceId } });

export const getSessions = (workspaceId: string): Promise<BrowserSession[]> =>
    apiClient.get('/api/browser/sessions', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
