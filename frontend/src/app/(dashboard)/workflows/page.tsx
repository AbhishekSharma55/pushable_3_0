'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
    Route,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    Zap,
    Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { CreateWorkflowSheet } from '@/components/workflows/create-workflow-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getWorkflows, updateWorkflow, deleteWorkflow } from '@/lib/api/workflows';
import { getAgents } from '@/lib/api/agents';
import type { Workflow, Agent } from '@/types';

export default function WorkflowsPage() {
    const workspace = useActiveWorkspace();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editWorkflow, setEditWorkflow] = useState<Workflow | null>(null);
    const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
    const [agentNameMap, setAgentNameMap] = useState<Record<string, string>>({});

    const fetchWorkflows = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getWorkflows(workspace.id);
            setWorkflows(data);
        } catch {
            toast.error('Failed to load workflows');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    const fetchAgentNames = useCallback(async () => {
        if (!workspace) return;
        try {
            const agents = await getAgents(workspace.id);
            const map: Record<string, string> = {};
            for (const a of agents) map[a.id] = a.name;
            setAgentNameMap(map);
        } catch {}
    }, [workspace]);

    useEffect(() => {
        fetchWorkflows();
        fetchAgentNames();
    }, [fetchWorkflows, fetchAgentNames]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteWorkflow(workspace.id, id);
            toast.success('Workflow deleted');
            fetchWorkflows();
        } catch {
            toast.error('Failed to delete workflow');
        }
    };

    const handleToggleEnabled = async (workflow: Workflow) => {
        if (!workspace) return;
        setTogglingIds((prev) => new Set(prev).add(workflow.id));
        try {
            await updateWorkflow(workspace.id, workflow.id, { enabled: !workflow.enabled });
            setWorkflows((prev) =>
                prev.map((w) => w.id === workflow.id ? { ...w, enabled: !w.enabled } : w)
            );
        } catch {
            toast.error('Failed to update workflow');
        } finally {
            setTogglingIds((prev) => {
                const next = new Set(prev);
                next.delete(workflow.id);
                return next;
            });
        }
    };

    const handleEdit = (workflow: Workflow) => {
        setEditWorkflow(workflow);
        setSheetOpen(true);
    };

    const handleCreate = () => {
        setEditWorkflow(null);
        setSheetOpen(true);
    };

    return (
        <TooltipProvider>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                            <Route className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
                            <p className="text-sm text-muted-foreground">
                                Compiled agent processes that run efficiently
                            </p>
                        </div>
                    </div>
                    <Button onClick={handleCreate} className="gap-1.5">
                        <Plus className="h-4 w-4" />
                        New Workflow
                    </Button>
                </div>

                {/* Workflow cards */}
                <div className="space-y-3">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="rounded-xl border border-border/60 bg-card p-5">
                                <div className="flex items-center gap-4">
                                    <Skeleton className="h-5 w-32" />
                                    <Skeleton className="h-4 w-48" />
                                    <Skeleton className="h-4 w-20 ml-auto" />
                                </div>
                            </div>
                        ))
                    ) : workflows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-center px-4 gap-3 rounded-xl border border-border/60 bg-card">
                            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                <Route className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-sm font-medium">No workflows yet</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Create your first workflow to compile agent processes into efficient pipelines.
                                </p>
                            </div>
                        </div>
                    ) : (
                        workflows.map((workflow) => (
                            <div key={workflow.id} className="group rounded-xl border border-border/60 bg-card px-5 py-4 transition-colors hover:bg-accent/30">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Link href={`/workflows/${workflow.id}`} className="text-sm font-semibold truncate hover:underline">
                                                {workflow.name}
                                            </Link>
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/20"
                                            >
                                                <Zap className="h-2.5 w-2.5 mr-0.5" />
                                                {workflow.recipe.steps.length} steps
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] px-1.5 py-0 bg-violet-500/10 text-violet-600 border-violet-500/20"
                                            >
                                                <Bot className="h-2.5 w-2.5 mr-0.5" />
                                                {agentNameMap[workflow.agentId] || 'Agent'}
                                            </Badge>
                                            {workflow.sourceSessionId && (
                                                <Tooltip>
                                                    <TooltipTrigger>
                                                        <Badge
                                                            variant="outline"
                                                            className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                                        >
                                                            Compiled
                                                        </Badge>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        Compiled from a conversation session
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </div>

                                        {workflow.description && (
                                            <p className="text-xs text-muted-foreground line-clamp-1">
                                                {workflow.description}
                                            </p>
                                        )}

                                        <div className="flex items-center gap-3 flex-wrap">
                                            <p className="text-xs text-muted-foreground/70">
                                                Last run:{' '}
                                                {workflow.lastRunAt
                                                    ? formatDistanceToNow(new Date(workflow.lastRunAt), { addSuffix: true })
                                                    : 'Never'}
                                            </p>
                                            {workflow.runCount > 0 && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                    {workflow.runCount} run{workflow.runCount !== 1 ? 's' : ''}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        {togglingIds.has(workflow.id) ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : (
                                            <Switch
                                                checked={workflow.enabled}
                                                onCheckedChange={() => handleToggleEnabled(workflow)}
                                            />
                                        )}
                                        <button
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                                            onClick={() => handleEdit(workflow)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Delete &quot;{workflow.name}&quot;? This cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDelete(workflow.id)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Create/Edit Sheet */}
                {workspace && (
                    <CreateWorkflowSheet
                        open={sheetOpen}
                        onOpenChange={setSheetOpen}
                        workspaceId={workspace.id}
                        workflow={editWorkflow}
                        onSuccess={() => { fetchWorkflows(); fetchAgentNames(); }}
                    />
                )}
            </div>
        </TooltipProvider>
    );
}
