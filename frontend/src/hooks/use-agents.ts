'use client';

import { useState, useEffect } from 'react';
import { getAgents } from '@/lib/api/agents';
import { useActiveWorkspace } from './use-active-workspace';

export interface Agent {
    id: string;
    name: string;
    systemPrompt: string | null;
    model: string;
    temperature: number;
    identity?: {
        name?: string;
        avatarUrl?: string;
        emoji?: string;
    };
    createdAt: string;
    updatedAt?: string;
}

interface AgentsData {
    agents: Agent[];
    defaultId: string;
}

export function useAgents() {
    const workspace = useActiveWorkspace();
    const [data, setData] = useState<AgentsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!workspace?.id) return;

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const raw = await getAgents(workspace.id);
                if (cancelled) return;

                const agents: Agent[] = (raw as Array<Record<string, unknown>>).map((a) => ({
                    id: a.id as string,
                    name: a.name as string,
                    systemPrompt: (a.systemPrompt as string) ?? null,
                    model: a.model as string,
                    temperature: a.temperature as number,
                    identity: {
                        name: a.name as string,
                        emoji: a.emoji as string | undefined,
                        avatarUrl: a.avatarUrl as string | undefined,
                    },
                    createdAt: a.createdAt as string,
                    updatedAt: a.updatedAt as string | undefined,
                }));

                setData({
                    agents,
                    defaultId: agents[0]?.id ?? '',
                });
            } catch {
                if (!cancelled) setData({ agents: [], defaultId: '' });
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [workspace?.id]);

    return { data, loading };
}
