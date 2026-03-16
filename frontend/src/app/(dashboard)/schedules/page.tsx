'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Clock,
    Plus,
    Trash2,
    Pencil,
    Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import cronstrue from 'cronstrue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
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
import { CreateScheduleSheet } from '@/components/schedules/create-schedule-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getSchedules, updateSchedule, deleteSchedule } from '@/lib/api/schedules';
import { getTasks } from '@/lib/api/tasks';
import { getWorkflows } from '@/lib/api/workflows';
import type { Schedule } from '@/types';

function cronToHuman(cron: string): string {
    try {
        return cronstrue.toString(cron);
    } catch {
        return 'Invalid';
    }
}

export default function SchedulesPage() {
    const workspace = useActiveWorkspace();
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
    const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
    const [targetNameMap, setTargetNameMap] = useState<Record<string, string>>({});

    const fetchSchedules = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getSchedules(workspace.id);
            setSchedules(data);
        } catch {
            toast.error('Failed to load schedules');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    const fetchTargetNames = useCallback(async () => {
        if (!workspace) return;
        try {
            const [tasks, workflows] = await Promise.all([
                getTasks(workspace.id),
                getWorkflows(workspace.id),
            ]);
            const map: Record<string, string> = {};
            for (const t of tasks) {
                map[t.id] = t.title;
            }
            for (const w of workflows) {
                map[w.id] = w.name;
            }
            setTargetNameMap(map);
        } catch {
            // silently fail — names will just not show
        }
    }, [workspace]);

    useEffect(() => {
        fetchSchedules();
        fetchTargetNames();
    }, [fetchSchedules, fetchTargetNames]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteSchedule(workspace.id, id);
            toast.success('Schedule deleted');
            fetchSchedules();
        } catch {
            toast.error('Failed to delete schedule');
        }
    };

    const handleToggleEnabled = async (schedule: Schedule) => {
        if (!workspace) return;
        setTogglingIds((prev) => new Set(prev).add(schedule.id));
        try {
            await updateSchedule(workspace.id, schedule.id, {
                enabled: !schedule.enabled,
            });
            setSchedules((prev) =>
                prev.map((s) =>
                    s.id === schedule.id ? { ...s, enabled: !s.enabled } : s
                )
            );
        } catch {
            toast.error('Failed to update schedule');
        } finally {
            setTogglingIds((prev) => {
                const next = new Set(prev);
                next.delete(schedule.id);
                return next;
            });
        }
    };

    const handleEdit = (schedule: Schedule) => {
        setEditSchedule(schedule);
        setSheetOpen(true);
    };

    const handleCreate = () => {
        setEditSchedule(null);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchSchedules();
        fetchTargetNames();
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20">
                        <Clock className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Schedules</h1>
                        <p className="text-sm text-muted-foreground">
                            Automate tasks with cron-based scheduling
                        </p>
                    </div>
                </div>
                <Button onClick={handleCreate} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    New Schedule
                </Button>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
                {loading ? (
                    <div className="p-6 space-y-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-4 w-20" />
                            </div>
                        ))}
                    </div>
                ) : schedules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center px-4 gap-3">
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                            <Clock className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                            <p className="text-sm font-medium">No schedules yet</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Create your first schedule to automate recurring tasks and workflows.
                            </p>
                        </div>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Target</TableHead>
                                <TableHead>Cron</TableHead>
                                <TableHead>Enabled</TableHead>
                                <TableHead>Last Run</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {schedules.map((schedule) => (
                                <TableRow key={schedule.id}>
                                    <TableCell className="font-medium">
                                        {schedule.name}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">
                                                {targetNameMap[schedule.targetId] || schedule.targetId}
                                            </span>
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 py-0 ${
                                                    schedule.targetType === 'task'
                                                        ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                                                        : 'bg-purple-500/10 text-purple-600 border-purple-500/20'
                                                }`}
                                            >
                                                {schedule.targetType}
                                            </Badge>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div>
                                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                                {schedule.cron}
                                            </code>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {cronToHuman(schedule.cron)}
                                            </p>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {togglingIds.has(schedule.id) ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : (
                                            <Switch
                                                checked={schedule.enabled}
                                                onCheckedChange={() => handleToggleEnabled(schedule)}
                                            />
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {schedule.lastRunAt
                                            ? new Date(schedule.lastRunAt).toLocaleDateString('en-US', {
                                                  month: 'short',
                                                  day: 'numeric',
                                                  year: 'numeric',
                                                  hour: '2-digit',
                                                  minute: '2-digit',
                                              })
                                            : 'Never'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                                onClick={() => handleEdit(schedule)}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Are you sure you want to delete &quot;{schedule.name}&quot;? This action cannot be undone.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDelete(schedule.id)}
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                        >
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            {/* Create/Edit Sheet */}
            {workspace && (
                <CreateScheduleSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    schedule={editSchedule}
                    onSuccess={handleSheetSuccess}
                />
            )}
        </div>
    );
}
