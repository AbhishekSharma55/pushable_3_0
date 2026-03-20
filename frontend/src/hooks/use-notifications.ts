'use client';

import { useState, useEffect, useCallback } from 'react';
import { useActiveWorkspace } from './use-active-workspace';
import { getPendingNotifications, type PendingNotification } from '@/lib/api/notifications';

const POLL_INTERVAL = 10_000; // 10 seconds

export function useNotifications() {
    const workspace = useActiveWorkspace();
    const [notifications, setNotifications] = useState<PendingNotification[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!workspace?.id) return;
        try {
            const data = await getPendingNotifications(workspace.id);
            setNotifications(data);
        } catch {
            // Silently fail — notifications are non-critical
        }
    }, [workspace?.id]);

    useEffect(() => {
        if (!workspace?.id) {
            setNotifications([]);
            return;
        }

        setLoading(true);
        refresh().finally(() => setLoading(false));

        const interval = setInterval(refresh, POLL_INTERVAL);
        return () => clearInterval(interval);
    }, [workspace?.id, refresh]);

    return { notifications, loading, refresh, count: notifications.length };
}
