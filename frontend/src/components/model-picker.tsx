'use client';

import { useEffect, useState, useMemo } from 'react';
import { Lock, Sparkles, Zap, Brain, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { getAllModels } from '@/lib/api/models';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import type { LLMModel } from '@/types';

interface ModelPickerProps {
    value: string;
    onChange: (modelId: string) => void;
}

const PLAN_BADGE_STYLES: Record<string, string> = {
    free: 'bg-green-500/10 text-green-600 border-green-500/20',
    starter: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    pro: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    scale: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
};

const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'deepseek', 'meta'];

function getModelTag(model: LLMModel): { label: string; icon: typeof Zap } | null {
    const name = model.displayName.toLowerCase();
    const desc = (model.description || '').toLowerCase();
    if (name.includes('codex') || desc.includes('coding')) return { label: 'Code', icon: Code };
    if (name.includes('flash') || name.includes('chat') || desc.includes('fast'))
        return { label: 'Fast', icon: Zap };
    if (name.includes('opus') || name.includes('pro') || desc.includes('frontier') || desc.includes('reasoning'))
        return { label: 'Reasoning', icon: Brain };
    if (model.isFeatured) return { label: 'Smart', icon: Sparkles };
    return null;
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
    const workspace = useActiveWorkspace();
    const [models, setModels] = useState<LLMModel[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!workspace) return;
        setLoading(true);
        getAllModels(workspace.id)
            .then(setModels)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [workspace]);

    const grouped = useMemo(() => {
        const groups = new Map<string, LLMModel[]>();
        for (const m of models) {
            const list = groups.get(m.provider) || [];
            list.push(m);
            groups.set(m.provider, list);
        }
        // Sort by provider order
        const sorted: { provider: string; models: LLMModel[] }[] = [];
        for (const p of PROVIDER_ORDER) {
            const list = groups.get(p);
            if (list) sorted.push({ provider: p, models: list });
        }
        // Any remaining providers
        for (const [p, list] of groups) {
            if (!PROVIDER_ORDER.includes(p)) sorted.push({ provider: p, models: list });
        }
        return sorted;
    }, [models]);

    if (loading) {
        return (
            <div className="rounded-lg border border-border/60 p-4 text-center text-sm text-muted-foreground">
                Loading models...
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border/60 overflow-hidden max-h-[400px] overflow-y-auto">
            {grouped.map(({ provider, models: providerModels }) => (
                <div key={provider}>
                    {/* Provider header */}
                    <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm px-3 py-1.5 border-b border-border/40">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {provider}
                        </span>
                    </div>

                    {/* Models */}
                    {providerModels.map((model) => {
                        const isSelected = value === model.modelId;
                        const isLocked = !model.available;
                        const tag = getModelTag(model);

                        return (
                            <button
                                key={model.modelId}
                                type="button"
                                className={cn(
                                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-border/20 last:border-b-0',
                                    isSelected
                                        ? 'bg-primary/5 border-l-2 border-l-primary'
                                        : 'hover:bg-accent/50',
                                    isLocked && 'opacity-50 cursor-not-allowed'
                                )}
                                onClick={() => {
                                    if (!isLocked) onChange(model.modelId);
                                }}
                                disabled={isLocked}
                            >
                                {/* Radio indicator */}
                                <div
                                    className={cn(
                                        'h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center',
                                        isSelected
                                            ? 'border-primary bg-primary'
                                            : 'border-muted-foreground/30'
                                    )}
                                >
                                    {isSelected && (
                                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                    )}
                                </div>

                                {/* Model info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium truncate">
                                            {model.displayName}
                                        </span>
                                        {isLocked && (
                                            <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                        )}
                                        {model.minimumPlan !== 'free' && (
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    'text-[9px] px-1 py-0 uppercase',
                                                    PLAN_BADGE_STYLES[model.minimumPlan] || ''
                                                )}
                                            >
                                                {model.minimumPlan}
                                            </Badge>
                                        )}
                                        {tag && (
                                            <Badge
                                                variant="outline"
                                                className="text-[9px] px-1 py-0 bg-muted/50"
                                            >
                                                <tag.icon className="h-2.5 w-2.5 mr-0.5" />
                                                {tag.label}
                                            </Badge>
                                        )}
                                    </div>
                                    {model.description && (
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                                            {model.description}
                                        </p>
                                    )}
                                </div>

                                {/* Credit cost */}
                                <div className="flex-shrink-0 text-right">
                                    <span className="text-xs text-muted-foreground">
                                        {model.creditCostPerMessage} cr/msg
                                    </span>
                                    {model.contextWindow && (
                                        <p className="text-[10px] text-muted-foreground/60">
                                            {(model.contextWindow / 1000).toFixed(0)}K ctx
                                        </p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
