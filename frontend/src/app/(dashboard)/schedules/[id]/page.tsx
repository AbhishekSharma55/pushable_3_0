'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft,
    Clock,
    Bot,
    Loader2,
    CheckCircle2,
    XCircle,
    SkipForward,
    Play,
    TrendingUp,
    Coins,
    Timer,
    ChevronDown,
    ChevronUp,
    Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getSchedule, getScheduleRuns, getScheduleStats, updateSchedule } from '@/lib/api/schedules';
import { getAgents } from '@/lib/api/agents';
import type { Schedule, ScheduleRun, ScheduleStats, Agent } from '@/types';

function formatDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

const STATUS_CONFIG = {
    running: { icon: Play, label: 'Running', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    completed: { icon: CheckCircle2, label: 'Completed', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    failed: { icon: XCircle, label: 'Failed', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
    skipped: { icon: SkipForward, label: 'Skipped', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
} as const;

export default function ScheduleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();
    const scheduleId = params.id as string;

    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [stats, setStats] = useState<ScheduleStats | null>(null);
    const [runs, setRuns] = useState<ScheduleRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [runsLoading, setRunsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
    const [agentName, setAgentName] = useState<string>('Agent');
    const [hasMore, setHasMore] = useState(true);

    const PAGE_SIZE = 50;

    const fetchSchedule = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getSchedule(workspace.id, scheduleId);
            setSchedule(data);
        } catch {
            toast.error('Failed to load schedule');
            router.push('/schedules');
        } finally {
            setLoading(false);
        }
    }, [workspace, scheduleId, router]);

    const fetchStats = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getScheduleStats(workspace.id, scheduleId);
            setStats(data);
        } catch {}
    }, [workspace, scheduleId]);

    const fetchRuns = useCallback(async () => {
        if (!workspace) return;
        try {
            setRunsLoading(true);
            const data = await getScheduleRuns(workspace.id, scheduleId, PAGE_SIZE, 0);
            setRuns(data);
            setHasMore(data.length === PAGE_SIZE);
        } catch {
            toast.error('Failed to load runs');
        } finally {
            setRunsLoading(false);
        }
    }, [workspace, scheduleId]);

    const fetchAgentName = useCallback(async () => {
        if (!workspace || !schedule) return;
        try {
            const agents = await getAgents(workspace.id);
            const agent = agents.find((a: Agent) => a.id === schedule.agentId);
            if (agent) setAgentName(agent.name);
        } catch {}
    }, [workspace, schedule]);

    useEffect(() => {
        fetchSchedule();
        fetchStats();
        fetchRuns();
    }, [fetchSchedule, fetchStats, fetchRuns]);

    useEffect(() => {
        fetchAgentName();
    }, [fetchAgentName]);

    const handleLoadMore = async () => {
        if (!workspace || loadingMore) return;
        setLoadingMore(true);
        try {
            const data = await getScheduleRuns(workspace.id, scheduleId, PAGE_SIZE, runs.length);
            setRuns((prev) => [...prev, ...data]);
            setHasMore(data.length === PAGE_SIZE);
        } catch {
            toast.error('Failed to load more runs');
        } finally {
            setLoadingMore(false);
        }
    };

    const handleToggleEnabled = async () => {
        if (!workspace || !schedule) return;
        setToggling(true);
        try {
            const updated = await updateSchedule(workspace.id, schedule.id, { enabled: !schedule.enabled });
            setSchedule(updated);
        } catch {
            toast.error('Failed to update schedule');
        } finally {
            setToggling(false);
        }
    };

    const toggleExpand = (runId: string) => {
        setExpandedRuns((prev) => {
            const next = new Set(prev);
            if (next.has(runId)) next.delete(runId);
            else next.add(runId);
            return next;
        });
    };

    const successRate = stats && stats.totalRuns > 0
        ? Math.round((stats.successCount / stats.totalRuns) * 100)
        : 0;

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-7 w-48" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-24 rounded-xl" />
                    ))}
                </div>
                <Skeleton className="h-64 rounded-xl" />
            </div>
        );
    }

    if (!schedule) return null;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Link
                        href="/schedules"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 hover:bg-accent transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold tracking-tight">{schedule.name}</h1>
                            <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-violet-500/10 text-violet-600 border-violet-500/20"
                            >
                                <Bot className="h-2.5 w-2.5 mr-0.5" />
                                {agentName}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm text-muted-foreground">
                                {schedule.naturalLanguage || schedule.cron}
                            </p>
                            {schedule.nextRunDescription && schedule.enabled && (
                                <span className="text-xs text-muted-foreground/70">
                                    · Next: {schedule.nextRunDescription}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {toggling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Switch
                            checked={schedule.enabled}
                            onCheckedChange={handleToggleEnabled}
                        />
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push('/schedules')}
                    >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Edit
                    </Button>
                </div>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Clock className="h-4 w-4" />
                        <span className="text-xs font-medium">Total Runs</span>
                    </div>
                    <p className="text-2xl font-bold">
                        {stats ? stats.totalRuns.toLocaleString() : <Skeleton className="h-8 w-16 inline-block" />}
                    </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Coins className="h-4 w-4" />
                        <span className="text-xs font-medium">Total Cost</span>
                    </div>
                    <p className="text-2xl font-bold">
                        {stats ? `${stats.totalCredits.toLocaleString()} credits` : <Skeleton className="h-8 w-24 inline-block" />}
                    </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <TrendingUp className="h-4 w-4" />
                        <span className="text-xs font-medium">Success Rate</span>
                    </div>
                    <p className="text-2xl font-bold">
                        {stats ? `${successRate}%` : <Skeleton className="h-8 w-16 inline-block" />}
                    </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Timer className="h-4 w-4" />
                        <span className="text-xs font-medium">Avg Duration</span>
                    </div>
                    <p className="text-2xl font-bold">
                        {stats ? formatDuration(stats.avgDurationMs) : <Skeleton className="h-8 w-16 inline-block" />}
                    </p>
                </div>
            </div>

            {/* Runs history */}
            <div className="rounded-xl border border-border/60 bg-card">
                <div className="px-5 py-3 border-b border-border/60">
                    <h2 className="text-sm font-semibold">Run History</h2>
                </div>

                {runsLoading ? (
                    <div className="p-5 space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4">
                                <Skeleton className="h-5 w-20" />
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-4 w-20 ml-auto" />
                            </div>
                        ))}
                    </div>
                ) : runs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">No runs yet</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Runs will appear here after the schedule fires.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-border/40">
                        {runs.map((run) => {
                            const config = STATUS_CONFIG[run.status];
                            const StatusIcon = config.icon;
                            const isExpanded = expandedRuns.has(run.id);
                            const hasDetail = run.resultText || run.error;

                            return (
                                <div key={run.id}>
                                    <button
                                        className="w-full px-5 py-3 flex items-center gap-4 text-left hover:bg-accent/30 transition-colors"
                                        onClick={() => hasDetail && toggleExpand(run.id)}
                                        disabled={!hasDetail}
                                    >
                                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 gap-1 ${config.className}`}>
                                            <StatusIcon className="h-2.5 w-2.5" />
                                            {config.label}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDate(run.startedAt)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDuration(run.durationMs)}
                                        </span>
                                        {run.creditsUsed > 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                {run.creditsUsed} credits
                                            </span>
                                        )}
                                        {hasDetail && (
                                            <span className="text-xs text-muted-foreground/50 truncate flex-1 text-right max-w-xs">
                                                {run.error || (run.resultText && run.resultText.substring(0, 80) + (run.resultText.length > 80 ? '...' : ''))}
                                            </span>
                                        )}
                                        {hasDetail && (
                                            <span className="ml-auto flex-shrink-0 text-muted-foreground/50">
                                                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                            </span>
                                        )}
                                    </button>
                                    {isExpanded && hasDetail && (
                                        <div className="px-5 pb-3">
                                            <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                                                {run.error || run.resultText}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {hasMore && runs.length > 0 && (
                    <div className="px-5 py-3 border-t border-border/40">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                        >
                            {loadingMore ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                            ) : null}
                            Load more
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
