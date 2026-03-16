'use client';

import { useState, useEffect } from 'react';
import { ACTIVE_WORKSPACE_KEY, WORKSPACES_KEY } from '@/lib/constants';
import type { Workspace } from '@/types';

export function useActiveWorkspace(): Workspace | null {
    const [workspace, setWorkspace] = useState<Workspace | null>(null);

    useEffect(() => {
        const raw = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
        if (raw) {
            try {
                setWorkspace(JSON.parse(raw));
            } catch {
                setWorkspace(null);
            }
        } else {
            // Fallback to first workspace
            const allRaw = localStorage.getItem(WORKSPACES_KEY);
            if (allRaw) {
                try {
                    const all = JSON.parse(allRaw);
                    if (all.length > 0) {
                        setWorkspace(all[0]);
                        localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(all[0]));
                    }
                } catch {
                    setWorkspace(null);
                }
            }
        }
    }, []);

    return workspace;
}
