'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft,
    Clock,
    Zap,
    TrendingUp,
    Timer,
    Wrench,
    Brain,
    Filter,
    Pencil,
    Play,
    ChevronDown,
    ChevronRight,
    Loader2,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { CreateWorkflowSheet } from '@/components/workflows/create-workflow-sheet';
import { RunWorkflowDialog } from '@/components/workflows/run-workflow-dialog';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getWorkflow,
    updateWorkflow,
    getWorkflowRuns,
    getWorkflowStats,
    runWorkflow,
} from '@/lib/api/workflows';
import { getAgents } from '@/lib/api/agents';
import type { Workflow, WorkflowRun, WorkflowStats, WorkflowStep, Agent } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null): string {
    if (ms === null) return '\u2014';
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

/** Replace {{placeholder}} tokens with styled spans. */
function highlightPlaceholders(text: string): React.ReactNode {
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, i) => {
        if (/^\{\{[^}]+\}\}$/.test(part)) {
            return (
                <span
                    key={i}
                    className="bg-amber-500/10 text-amber-600 rounded px-1 font-mono text-xs"
                >
                    {part}
                </span>
            );
        }
        return <Fragment key={i}>{part}</Fragment>;
    });
}

const RUN_STATUS_CONFIG = {
    running: { icon: Play, label: 'Running', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    completed: { icon: CheckCircle2, label: 'Completed', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    failed: { icon: XCircle, label: 'Failed', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
} as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WorkflowDetailPage() {
    const params = useParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();
    const workflowId = params.id as string;

    const [workflow, setWorkflow] = useState<Workflow | null>(null);
    const [stats, setStats] = useState<WorkflowStats | null>(null);
    const [runs, setRuns] = useState<WorkflowRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [runsLoading, setRunsLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
    const [agentName, setAgentName] = useState<string>('Agent');
    const [hasMore, setHasMore] = useState(true);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [runDialogOpen, setRunDialogOpen] = useState(false);

    const PAGE_SIZE = 50;

    // --- Data fetching --------------------------------------------------

    const fetchWorkflow = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getWorkflow(workspace.id, workflowId);
            setWorkflow(data);
        } catch {
            toast.error('Failed to load workflow');
            router.push('/workflows');
        } finally {
            setLoading(false);
        }
    }, [workspace, workflowId, router]);

    const fetchStats = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getWorkflowStats(workspace.id, workflowId);
            setStats(data);
        } catch {}
    }, [workspace, workflowId]);

    const fetchRuns = useCallback(async () => {
        if (!workspace) return;
        try {
            setRunsLoading(true);
            const data = await getWorkflowRuns(workspace.id, workflowId, PAGE_SIZE, 0);
            setRuns(data);
            setHasMore(data.length === PAGE_SIZE);
        } catch {
            toast.error('Failed to load runs');
        } finally {
            setRunsLoading(false);
        }
    }, [workspace, workflowId]);

    const fetchAgentName = useCallback(async () => {
        if (!workspace || !workflow) return;
        try {
            const agents = await getAgents(workspace.id);
            const agent = agents.find((a: Agent) => a.id === workflow.agentId);
            if (agent) setAgentName(agent.name);
        } catch {}
    }, [workspace, workflow]);

    useEffect(() => {
        fetchWorkflow();
        fetchStats();
        fetchRuns();
    }, [fetchWorkflow, fetchStats, fetchRuns]);

    useEffect(() => {
        fetchAgentName();
    }, [fetchAgentName]);

    // --- Handlers -------------------------------------------------------

    const handleLoadMore = async () => {
        if (!workspace || loadingMore) return;
        setLoadingMore(true);
        try {
            const data = await getWorkflowRuns(workspace.id, workflowId, PAGE_SIZE, runs.length);
            setRuns((prev) => [...prev, ...data]);
            setHasMore(data.length === PAGE_SIZE);
        } catch {
            toast.error('Failed to load more runs');
        } finally {
            setLoadingMore(false);
        }
    };

    const handleToggleEnabled = async () => {
        if (!workspace || !workflow) return;
        setToggling(true);
        try {
            const updated = await updateWorkflow(workspace.id, workflow.id, { enabled: !workflow.enabled });
            setWorkflow(updated);
        } catch {
            toast.error('Failed to update workflow');
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

    const handleRunComplete = () => {
        fetchRuns();
        fetchStats();
        fetchWorkflow();
    };

    const successRate =
        stats && stats.totalRuns > 0
            ? Math.round((stats.successCount / stats.totalRuns) * 100)
            : 0;

    // --- Loading skeleton -----------------------------------------------

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

    if (!workflow) return null;

    const steps = workflow.recipe.steps;
    const inputEntries = Object.entries(workflow.inputSchema ?? {});

    // --- Render ---------------------------------------------------------

    return (
        <div className="space-y-6">
            {/* ---- Section 1: Header ---- */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Link
                        href="/workflows"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 hover:bg-accent transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold tracking-tight">{workflow.name}</h1>
                            <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-violet-500/10 text-violet-600 border-violet-500/20"
                            >
                                <Bot className="h-2.5 w-2.5 mr-0.5" />
                                {agentName}
                            </Badge>
                        </div>
                        {workflow.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                                {workflow.description}
                            </p>
                        )}
                    </div>
                </div>

                {/* ---- Section 2: Action bar ---- */}
                <div className="flex items-center gap-2">
                    {toggling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Switch
                            checked={workflow.enabled}
                            onCheckedChange={handleToggleEnabled}
                        />
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSheetOpen(true)}
                    >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setRunDialogOpen(true)}
                    >
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        Run Workflow
                    </Button>
                </div>
            </div>

            {/* ---- Section 3: Stats grid ---- */}
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
                        <Zap className="h-4 w-4" />
                        <span className="text-xs font-medium">Credits Used</span>
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

            {/* ---- Section 4: Recipe visualization ---- */}
            <div className="rounded-xl border border-border/60 bg-card">
                <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Recipe Steps</h2>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {steps.length} step{steps.length !== 1 ? 's' : ''}
                    </Badge>
                </div>

                <div className="p-5 space-y-3">
                    {steps.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            No steps defined in this workflow.
                        </p>
                    ) : (
                        steps.map((step: WorkflowStep, index: number) => (
                            <div
                                key={step.id}
                                className="border-l-2 border-blue-500/30 pl-4 py-2 space-y-1.5"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-muted-foreground/70">
                                        {index + 1}.
                                    </span>
                                    {step.type === 'tool' ? (
                                        <>
                                            <Wrench className="h-3.5 w-3.5 text-blue-500" />
                                            <span className="text-sm font-semibold">
                                                {step.tool}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <Brain className="h-3.5 w-3.5 text-purple-500" />
                                            <span className="text-sm font-semibold">
                                                LLM Processing
                                            </span>
                                        </>
                                    )}
                                    {step.outputKey && (
                                        <Badge
                                            variant="outline"
                                            className="text-[9px] px-1 py-0 ml-auto"
                                        >
                                            {step.outputKey}
                                        </Badge>
                                    )}
                                </div>

                                {/* Tool args */}
                                {step.type === 'tool' && step.args && Object.keys(step.args).length > 0 && (
                                    <div className="ml-6 space-y-0.5">
                                        {Object.entries(step.args).map(([key, value]) => (
                                            <div key={key} className="text-xs text-muted-foreground">
                                                <span className="font-medium">{key}:</span>{' '}
                                                <span>
                                                    {highlightPlaceholders(String(value))}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Nano LLM prompt */}
                                {step.type === 'nano_llm' && step.prompt && (
                                    <p className="ml-6 text-xs text-muted-foreground">
                                        {highlightPlaceholders(step.prompt)}
                                    </p>
                                )}

                                {/* Condition */}
                                {step.condition && (
                                    <div className="ml-6 flex items-center gap-1.5">
                                        <Filter className="h-3 w-3 text-muted-foreground/60" />
                                        <span className="text-xs text-muted-foreground">
                                            {step.condition}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ---- Section 5: Input schema ---- */}
            {inputEntries.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-card">
                    <div className="px-5 py-3 border-b border-border/60">
                        <h2 className="text-sm font-semibold">Input Schema</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/40 text-left">
                                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground">Parameter</th>
                                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground">Type</th>
                                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground">Description</th>
                                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground">Required</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                                {inputEntries.map(([paramName, param]) => (
                                    <tr key={paramName}>
                                        <td className="px-5 py-2 font-mono text-xs">{paramName}</td>
                                        <td className="px-5 py-2">
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                {param.type}
                                            </Badge>
                                        </td>
                                        <td className="px-5 py-2 text-xs text-muted-foreground">
                                            {param.description}
                                        </td>
                                        <td className="px-5 py-2">
                                            {param.required ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                            ) : (
                                                <span className="text-xs text-muted-foreground">Optional</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ---- Section 6: Run history ---- */}
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
                            Runs will appear here after the workflow is executed.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-border/40">
                        {runs.map((run) => {
                            const config = RUN_STATUS_CONFIG[run.status];
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
                                            {formatDuration(run.durationMs)}
                                        </span>
                                        {run.creditsUsed > 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                {run.creditsUsed} credits
                                            </span>
                                        )}
                                        <span className="text-xs text-muted-foreground ml-auto">
                                            {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                                        </span>
                                        {hasDetail && (
                                            <span className="flex-shrink-0 text-muted-foreground/50">
                                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
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
                            Load More
                        </Button>
                    </div>
                )}
            </div>

            {/* ---- Section 7: Dialogs / Sheets ---- */}
            {workspace && (
                <>
                    <CreateWorkflowSheet
                        open={sheetOpen}
                        onOpenChange={setSheetOpen}
                        workspaceId={workspace.id}
                        workflow={workflow}
                        onSuccess={() => {
                            fetchWorkflow();
                        }}
                    />
                    <RunWorkflowDialog
                        open={runDialogOpen}
                        onOpenChange={setRunDialogOpen}
                        workspaceId={workspace.id}
                        workflow={workflow}
                        onComplete={handleRunComplete}
                    />
                </>
            )}
        </div>
    );
}
