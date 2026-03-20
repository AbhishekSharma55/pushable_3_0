import { apiClient } from './client';
import type { ChannelConnection } from '@/types';

export interface CreateChannelInput {
    agentId: string;
    channelType: 'telegram' | 'slack';
    name: string;
    credentials: Record<string, unknown>;
    config?: Record<string, unknown>;
}

export interface TestResult {
    success: boolean;
    details: Record<string, unknown>;
}

export const getConnections = (workspaceId: string): Promise<ChannelConnection[]> =>
    apiClient.get('/api/channels', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createConnection = (workspaceId: string, data: CreateChannelInput): Promise<ChannelConnection> =>
    apiClient.post('/api/channels', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const testConnection = (workspaceId: string, id: string): Promise<TestResult> =>
    apiClient.post(`/api/channels/${id}/test`, {}, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateConnection = (workspaceId: string, id: string, data: Partial<CreateChannelInput>): Promise<ChannelConnection> =>
    apiClient.put(`/api/channels/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteConnection = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/channels/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export interface BotInfo {
    username: string;
    firstName: string;
    deepLink: string;
}

export const getBotInfo = (workspaceId: string, id: string): Promise<BotInfo> =>
    apiClient.get(`/api/channels/${id}/bot-info`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getConnectionConfig = (workspaceId: string, id: string): Promise<Record<string, unknown>> =>
    apiClient.get(`/api/channels/${id}/config`, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
