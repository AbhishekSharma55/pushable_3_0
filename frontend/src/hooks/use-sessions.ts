'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAllSessions, createSession as apiCreateSession } from '@/lib/api/sessions';
import { useActiveWorkspace } from './use-active-workspace';

export interface Session {
    /** Canonical key used by the UI: "agent:<agentId>:<sessionId>" */
    key: string;
    /** Real DB session UUID */
    id: string;
    agentId: string;
    title: string;
    createdAt: string;
    updatedAt?: string;
    /** Derived display title */
    derivedTitle?: string;
    /** Channel origin (for multi-channel display) */
    channel?: string;
    origin?: string;
    kind?: string;
    label?: string;
    displayName?: string;
}

interface SessionsData {
    sessions: Session[];
}

/**
 * Build canonical session key from DB session.
 * Format: "agent:<agentId>:<sessionId>"
 */
function buildKey(agentId: string, sessionId: string): string {
    return `agent:${agentId}:${sessionId}`;
}

export function useSessions(limit?: number) {
    const workspace = useActiveWorkspace();
    const [data, setData] = useState<SessionsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshToken, setRefreshToken] = useState(0);

    useEffect(() => {
        if (!workspace?.id) return;

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const raw = await getAllSessions(workspace.id);
                if (cancelled) return;

                let sessions: Session[] = (raw as Array<Record<string, unknown>>).map((s) => {
                    const agentId = s.agentId as string;
                    const id = s.id as string;
                    return {
                        key: buildKey(agentId, id),
                        id,
                        agentId,
                        title: s.title as string,
                        createdAt: s.createdAt as string,
                        updatedAt: (s.updatedAt as string) ?? (s.createdAt as string),
                        derivedTitle: s.title as string,
                    };
                });

                // Sort by most recent first
                sessions.sort((a, b) => {
                    const ta = new Date(a.updatedAt ?? a.createdAt).getTime();
                    const tb = new Date(b.updatedAt ?? b.createdAt).getTime();
                    return tb - ta;
                });

                if (limit) {
                    sessions = sessions.slice(0, limit);
                }

                setData({ sessions });
            } catch {
                if (!cancelled) setData({ sessions: [] });
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [workspace?.id, limit, refreshToken]);

    const refresh = useCallback(() => {
        setRefreshToken((t) => t + 1);
    }, []);

    return { data, loading, refresh };
}

/**
 * Parse the real session UUID from a canonical key.
 * Returns null for keys that don't encode a real session ID (e.g. "new-xxx").
 */
export function parseSessionIdFromKey(key: string): string | null {
    const parts = key.split(':');
    if (parts.length >= 3 && parts[0].toLowerCase() === 'agent') {
        const sessionPart = parts[2];
        // UUID format check (loose)
        if (sessionPart && /^[0-9a-f]{8}-[0-9a-f]{4}/.test(sessionPart)) {
            return sessionPart;
        }
    }
    return null;
}
