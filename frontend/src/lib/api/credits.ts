import { apiClient } from './client';
import type { CreditBalance, LedgerEntry } from '@/types';

export const getCreditBalance = (workspaceId: string): Promise<CreditBalance> =>
    apiClient.get('/api/credits/balance', { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const devTopup = (workspaceId: string, amount: number): Promise<{ creditsAfter: number; added: number }> =>
    apiClient.post('/api/credits/dev-topup', { amount }, { headers: { 'x-workspace-id': workspaceId } }).then(r => r.data.data);

export const getCreditLedger = (
    workspaceId: string,
    options?: { limit?: number; type?: string }
): Promise<{ data: LedgerEntry[]; nextCursor: string | null }> => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.type) params.set('type', options.type);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiClient
        .get(`/api/credits/ledger${qs}`, { headers: { 'x-workspace-id': workspaceId } })
        .then(r => ({ data: r.data.data, nextCursor: r.data.nextCursor ?? null }));
};
