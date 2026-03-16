'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    GitBranch,
    Plus,
    Trash2,
    Play,
    Sparkles,
    GripVertical,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable,
    arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { CreateWorkflowSheet } from '@/components/workflows/create-workflow-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getWorkflows,
    getWorkflow,
    deleteWorkflow,
    addStep,
    removeStep,
    reorderSteps,
    runWorkflow,
} from '@/lib/api/workflows';
import { getTasks } from '@/lib/api/tasks';
import type { Workflow, WorkflowStep, Task } from '@/types';

const statusBadge = (status: string) => {
    switch (status) {
        case 'running':
            return 'bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse';
        case 'done':
            return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
        case 'failed':
            return 'bg-red-500/10 text-red-600 border-red-500/20';
        default:
            return 'bg-muted text-muted-foreground';
    }
};

/* ─── Sortable step row ─── */
function SortableStepItem({
    step,
    taskMap,
    onRemove,
}: {
    step: WorkflowStep;
    taskMap: Map<string, Task>;
    onRemove: (stepId: string) => void;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: step.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const task = taskMap.get(step.taskId);

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="group flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3 hover:bg-accent/50 transition-colors"
        >
            <button
                className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="h-4 w-4" />
            </button>

            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary flex-shrink-0">
                #{step.order}
            </span>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                    {task?.title ?? 'Unknown task'}
                </p>
            </div>

            {task && (
                <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${statusBadge(task.status)}`}
                >
                    {task.status}
                </Badge>
            )}

            <button
                onClick={() => onRemove(step.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

/* ─── Main page ─── */
export default function WorkflowsPage() {
    const workspace = useActiveWorkspace();
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<(Workflow & { steps: WorkflowStep[] }) | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editWorkflow, setEditWorkflow] = useState<Workflow | null>(null);

    // tasks
    const [tasks, setTasks] = useState<Task[]>([]);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // add-step dialog
    const [addStepOpen, setAddStepOpen] = useState(false);

    // polling ref
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    );

    /* ── Fetch workflows list ── */
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

    /* ── Fetch tasks ── */
    const fetchTasks = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getTasks(workspace.id);
            setTasks(data);
        } catch {
            /* silent */
        }
    }, [workspace]);

    /* ── Fetch single workflow detail ── */
    const fetchDetail = useCallback(
        async (id: string, silent = false) => {
            if (!workspace) return;
            if (!silent) setDetailLoading(true);
            try {
                const data = await getWorkflow(workspace.id, id);
                data.steps = [...data.steps].sort((a, b) => a.order - b.order);
                setDetail(data);
            } catch {
                if (!silent) toast.error('Failed to load workflow');
            } finally {
                if (!silent) setDetailLoading(false);
            }
        },
        [workspace],
    );

    useEffect(() => {
        fetchWorkflows();
        fetchTasks();
    }, [fetchWorkflows, fetchTasks]);

    /* ── When selection changes, fetch detail ── */
    useEffect(() => {
        if (selectedId) {
            fetchDetail(selectedId);
        } else {
            setDetail(null);
        }
    }, [selectedId, fetchDetail]);

    /* ── Auto-poll while any step's task is running ── */
    useEffect(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }

        if (!detail || !workspace) return;

        const hasRunning = detail.steps.some((s) => {
            const t = taskMap.get(s.taskId);
            return t?.status === 'running';
        });

        if (hasRunning) {
            pollRef.current = setInterval(() => {
                fetchDetail(detail.id, true);
                fetchTasks();
            }, 3000);
        }

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail, workspace]);

    /* ── Handlers ── */
    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteWorkflow(workspace.id, id);
            toast.success('Workflow deleted');
            if (selectedId === id) {
                setSelectedId(null);
                setDetail(null);
            }
            fetchWorkflows();
        } catch {
            toast.error('Failed to delete workflow');
        }
    };

    const handleRun = async (id: string) => {
        if (!workspace) return;
        try {
            await runWorkflow(workspace.id, id);
            toast.success('Workflow started');
            fetchDetail(id);
            fetchTasks();
        } catch {
            toast.error('Failed to run workflow');
        }
    };

    const handleCreate = () => {
        setEditWorkflow(null);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchWorkflows();
        setSelectedId(null);
        setDetail(null);
    };

    const handleRemoveStep = async (stepId: string) => {
        if (!workspace || !detail) return;
        try {
            await removeStep(workspace.id, detail.id, stepId);
            toast.success('Step removed');
            fetchDetail(detail.id);
        } catch {
            toast.error('Failed to remove step');
        }
    };

    const handleAddStep = async (taskId: string) => {
        if (!workspace || !detail) return;
        try {
            await addStep(workspace.id, detail.id, taskId);
            toast.success('Step added');
            setAddStepOpen(false);
            fetchDetail(detail.id);
        } catch {
            toast.error('Failed to add step');
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        if (!workspace || !detail) return;
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = detail.steps.findIndex((s) => s.id === active.id);
        const newIndex = detail.steps.findIndex((s) => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const reordered = arrayMove(detail.steps, oldIndex, newIndex).map(
            (s, i) => ({ ...s, order: i + 1 }),
        );

        // Optimistic update
        setDetail({ ...detail, steps: reordered });

        try {
            await reorderSteps(
                workspace.id,
                detail.id,
                reordered.map((s) => ({ id: s.id, order: s.order })),
            );
        } catch {
            toast.error('Failed to reorder steps');
            fetchDetail(detail.id);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                    <GitBranch className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
                    <p className="text-sm text-muted-foreground">
                        Build multi-step agent workflows
                    </p>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-6 h-[calc(100vh-200px)]">
                {/* Left panel — Workflow list */}
                <div className="w-[320px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-4 border-b border-border/60 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Workflows
                        </h2>
                        <Button
                            size="sm"
                            onClick={handleCreate}
                            className="gap-1.5"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New Workflow
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="p-3 space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-20" />
                                </div>
                            ))
                        ) : workflows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">No workflows yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Create your first workflow to chain tasks together.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            workflows.map((wf) => (
                                <div
                                    key={wf.id}
                                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer transition-all duration-150 hover:bg-accent ${
                                        selectedId === wf.id
                                            ? 'bg-accent ring-1 ring-border'
                                            : ''
                                    }`}
                                    onClick={() => setSelectedId(wf.id)}
                                >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-purple-500/15 flex-shrink-0">
                                        <GitBranch className="h-4 w-4 text-violet-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {wf.name}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground"
                                            >
                                                {wf.steps?.length ?? 0} steps
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Play button */}
                                    <button
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRun(wf.id);
                                        }}
                                    >
                                        <Play className="h-3.5 w-3.5" />
                                    </button>

                                    {/* Delete button */}
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Are you sure you want to delete &quot;{wf.name}&quot;? This action cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDelete(wf.id)}
                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                >
                                                    Delete
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right panel — Workflow detail */}
                <div className="flex-1 rounded-xl border border-border/60 bg-card overflow-hidden">
                    {detailLoading ? (
                        <div className="p-6 space-y-4">
                            <Skeleton className="h-6 w-48" />
                            <Skeleton className="h-4 w-32" />
                            <div className="space-y-2 mt-6">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                                ))}
                            </div>
                        </div>
                    ) : detail ? (
                        <div className="h-full flex flex-col">
                            {/* Workflow header */}
                            <div className="p-6 border-b border-border/60">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                                            <GitBranch className="h-7 w-7 text-violet-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold">{detail.name}</h2>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {detail.steps.length} step{detail.steps.length !== 1 ? 's' : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        onClick={() => handleRun(detail.id)}
                                        className="gap-1.5"
                                    >
                                        <Play className="h-3.5 w-3.5" />
                                        Run
                                    </Button>
                                </div>
                            </div>

                            {/* Steps list */}
                            <div className="flex-1 p-6 overflow-y-auto space-y-4">
                                {detail.steps.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                                        <p className="text-sm text-muted-foreground">
                                            No steps yet. Add tasks to build your workflow.
                                        </p>
                                    </div>
                                ) : (
                                    <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragEnd={handleDragEnd}
                                    >
                                        <SortableContext
                                            items={detail.steps.map((s) => s.id)}
                                            strategy={verticalListSortingStrategy}
                                        >
                                            <div className="space-y-2">
                                                {detail.steps.map((step) => (
                                                    <SortableStepItem
                                                        key={step.id}
                                                        step={step}
                                                        taskMap={taskMap}
                                                        onRemove={handleRemoveStep}
                                                    />
                                                ))}
                                            </div>
                                        </SortableContext>
                                    </DndContext>
                                )}

                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => setAddStepOpen(true)}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Step
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 flex items-center justify-center">
                                <GitBranch className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">
                                    Select a workflow
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Choose a workflow from the list to view and manage its steps.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit Sheet */}
            {workspace && (
                <CreateWorkflowSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    workflow={editWorkflow}
                    onSuccess={handleSheetSuccess}
                />
            )}

            {/* Add Step Dialog */}
            <Dialog open={addStepOpen} onOpenChange={setAddStepOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add Step</DialogTitle>
                        <DialogDescription>
                            Select a task to add as a workflow step.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[360px] overflow-y-auto space-y-1 mt-2">
                        {tasks.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-6">
                                No tasks available. Create a task first.
                            </p>
                        ) : (
                            tasks.map((task) => (
                                <button
                                    key={task.id}
                                    onClick={() => handleAddStep(task.id)}
                                    className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {task.title}
                                        </p>
                                        {task.description && (
                                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                                                {task.description}
                                            </p>
                                        )}
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${statusBadge(task.status)}`}
                                    >
                                        {task.status}
                                    </Badge>
                                </button>
                            ))
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
