import { apiClient } from './client';
import type { Schedule } from '@/types';

export interface CreateScheduleInput {
    name: string;
    cron: string;
    targetType: 'task' | 'workflow';
    targetId: string;
    enabled?: boolean;
}

export const getSchedules = (workspaceId: string): Promise<Schedule[]> =>
    apiClient.get('/api/schedules', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createSchedule = (workspaceId: string, data: CreateScheduleInput): Promise<Schedule> =>
    apiClient.post('/api/schedules', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateSchedule = (workspaceId: string, id: string, data: Partial<CreateScheduleInput>): Promise<Schedule> =>
    apiClient.put(`/api/schedules/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteSchedule = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/schedules/${id}`, { headers: { 'x-workspace-id': workspaceId } });
