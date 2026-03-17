import { apiClient } from './client';
import type { Schedule, SchedulePreset } from '@/types';

export interface CreateScheduleInput {
    name: string;
    targetType: 'task' | 'workflow';
    targetId: string;
    enabled?: boolean;
    scheduleType: 'natural' | 'preset' | 'custom';
    naturalLanguage?: string;
    presetKey?: string;
    cronExpression?: string;
    timezone?: string;
    humanizeDelay?: number;
    businessHoursOnly?: boolean;
    workStartHour?: number;
    workEndHour?: number;
    workDays?: number[];
}

export interface PreviewResult {
    cron: string;
    humanReadable: string;
    nextRuns: string[];
}

export const getSchedules = (workspaceId: string): Promise<Schedule[]> =>
    apiClient.get('/api/schedules', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const createSchedule = (workspaceId: string, data: CreateScheduleInput): Promise<Schedule> =>
    apiClient.post('/api/schedules', data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const updateSchedule = (workspaceId: string, id: string, data: Partial<{ name: string; cron: string; enabled: boolean }>): Promise<Schedule> =>
    apiClient.put(`/api/schedules/${id}`, data, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const deleteSchedule = (workspaceId: string, id: string) =>
    apiClient.delete(`/api/schedules/${id}`, { headers: { 'x-workspace-id': workspaceId } });

export const getPresets = (workspaceId: string): Promise<SchedulePreset[]> =>
    apiClient.get('/api/schedules/presets', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const previewSchedule = (workspaceId: string, naturalLanguage: string, timezone: string): Promise<PreviewResult> =>
    apiClient.post('/api/schedules/preview', { naturalLanguage, timezone }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);
