'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    ListTodo,
    Plus,
    Trash2,
    Play,
    Sparkles,
    Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { CreateTaskSheet } from '@/components/tasks/create-task-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getTasks, getTask, deleteTask, runTask } from '@/lib/api/tasks';
import { getAgents } from '@/lib/api/agents';
import type { Task, Agent } from '@/types';

const statusBadgeClass: Record<Task['status'], string> = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse',
    done: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    failed: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function TasksPage() {
    const workspace = useActiveWorkspace();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchTasks = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getTasks(workspace.id);
            setTasks(data);
        } catch {
            toast.error('Failed to load tasks');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    const fetchAgents = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getAgents(workspace.id);
            setAgents(data);
        } catch {
            /* silently ignore */
        }
    }, [workspace]);

    useEffect(() => {
        fetchTasks();
        fetchAgents();
    }, [fetchTasks, fetchAgents]);

    // Auto-refresh: poll getTask every 3s while selected task is running
    useEffect(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }

        if (!workspace || !selectedTask || selectedTask.status !== 'running') return;

        pollRef.current = setInterval(async () => {
            try {
                const updated = await getTask(workspace.id, selectedTask.id);
                setSelectedTask(updated);
                setTasks((prev) =>
                    prev.map((t) => (t.id === updated.id ? updated : t)),
                );
                if (updated.status !== 'running') {
                    if (pollRef.current) clearInterval(pollRef.current);
                    pollRef.current = null;
                    setRunningIds((prev) => {
                        const next = new Set(prev);
                        next.delete(updated.id);
                        return next;
                    });
                }
            } catch {
                /* ignore polling errors */
            }
        }, 3000);

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [workspace, selectedTask?.id, selectedTask?.status]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteTask(workspace.id, id);
            toast.success('Task deleted');
            if (selectedTask?.id === id) setSelectedTask(null);
            fetchTasks();
        } catch {
            toast.error('Failed to delete task');
        }
    };

    const handleRun = async (task: Task) => {
        if (!workspace) return;
        try {
            setRunningIds((prev) => new Set(prev).add(task.id));
            const updated = await runTask(workspace.id, task.id);
            setTasks((prev) =>
                prev.map((t) => (t.id === updated.id ? updated : t)),
            );
            if (selectedTask?.id === task.id) setSelectedTask(updated);
            toast.success('Task started');
        } catch {
            setRunningIds((prev) => {
                const next = new Set(prev);
                next.delete(task.id);
                return next;
            });
            toast.error('Failed to run task');
        }
    };

    const handleEdit = (task: Task) => {
        setEditTask(task);
        setSheetOpen(true);
    };

    const handleCreate = () => {
        setEditTask(null);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchTasks();
        setSelectedTask(null);
    };

    const agentName = (agentId: string) => {
        const agent = agents.find((a) => a.id === agentId);
        return agent?.name ?? agentId;
    };

    const isTaskRunning = (task: Task) =>
        task.status === 'running' || runningIds.has(task.id);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                    <ListTodo className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
                    <p className="text-sm text-muted-foreground">
                        Monitor and manage agent tasks
                    </p>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-6 h-[calc(100vh-200px)]">
                {/* Left panel — Task list */}
                <div className="w-[320px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-4 border-b border-border/60 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Tasks
                        </h2>
                        <Button
                            size="sm"
                            onClick={handleCreate}
                            className="gap-1.5"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New Task
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
                        ) : tasks.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">No tasks yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Create your first task to start automating.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            tasks.map((task) => (
                                <div
                                    key={task.id}
                                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer transition-all duration-150 hover:bg-accent ${
                                        selectedTask?.id === task.id
                                            ? 'bg-accent ring-1 ring-border'
                                            : ''
                                    }`}
                                    onClick={() => setSelectedTask(task)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {task.title}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 py-0 ${statusBadgeClass[task.status]}`}
                                            >
                                                {task.status}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {/* Play / Run button */}
                                        <button
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRun(task);
                                            }}
                                            disabled={isTaskRunning(task)}
                                        >
                                            {isTaskRunning(task) ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Play className="h-3.5 w-3.5" />
                                            )}
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
                                                    <AlertDialogTitle>Delete Task</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Are you sure you want to delete &quot;{task.title}&quot;? This action cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDelete(task.id)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right panel — Task detail */}
                <div className="flex-1 rounded-xl border border-border/60 bg-card overflow-hidden">
                    {selectedTask ? (
                        <div className="h-full flex flex-col">
                            {/* Task header */}
                            <div className="p-6 border-b border-border/60">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                                            <ListTodo className="h-7 w-7 text-violet-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold">{selectedTask.title}</h2>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-xs ${statusBadgeClass[selectedTask.status]}`}
                                                >
                                                    {selectedTask.status}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleEdit(selectedTask)}
                                            className="gap-1.5"
                                        >
                                            Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => handleRun(selectedTask)}
                                            disabled={isTaskRunning(selectedTask)}
                                            className="gap-1.5"
                                        >
                                            {isTaskRunning(selectedTask) ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Play className="h-3.5 w-3.5" />
                                            )}
                                            Run
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Task details */}
                            <div className="flex-1 p-6 overflow-y-auto space-y-6">
                                {selectedTask.description && (
                                    <div>
                                        <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                            Description
                                        </h3>
                                        <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                            <p className="text-sm leading-relaxed">
                                                {selectedTask.description}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                        Agent
                                    </h3>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-sm font-medium">
                                            {agentName(selectedTask.agentId)}
                                        </p>
                                    </div>
                                </div>

                                {(selectedTask.status === 'done' || selectedTask.status === 'failed') && selectedTask.result && (
                                    <div>
                                        <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                            Result
                                        </h3>
                                        <div className="rounded-lg bg-muted/50 border border-border/40 p-4 max-h-80 overflow-y-auto">
                                            <pre className="text-sm font-mono whitespace-pre-wrap break-words">
                                                {selectedTask.result}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Created</p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedTask.createdAt).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Last Updated</p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedTask.updatedAt).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 flex items-center justify-center">
                                <ListTodo className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">
                                    Select a task
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Choose a task from the list to view details and results.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit Sheet */}
            {workspace && (
                <CreateTaskSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    task={editTask}
                    onSuccess={handleSheetSuccess}
                />
            )}
        </div>
    );
}
