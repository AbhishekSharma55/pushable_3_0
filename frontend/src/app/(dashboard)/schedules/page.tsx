'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Clock,
    Plus,
    Trash2,
    Pencil,
    Loader2,
    Briefcase,
    Timer,
    Globe,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { CreateScheduleSheet } from '@/components/schedules/create-schedule-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getSchedules, updateSchedule, deleteSchedule } from '@/lib/api/schedules';
import { getTasks } from '@/lib/api/tasks';
import { getWorkflows } from '@/lib/api/workflows';
import type { Schedule } from '@/types';

function getScheduleDescription(schedule: Schedule): string {
    if (schedule.naturalLanguage) return schedule.naturalLanguage;
    if (schedule.presetKey) {
        // Capitalize and format preset key
        return schedule.presetKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return schedule.cron;
}

function getTimezoneAbbr(tz: string): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
            .formatToParts(new Date());
        return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
    } catch {
        return tz;
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
            for (const t of tasks) map[t.id] = t.title;
            for (const w of workflows) map[w.id] = w.name;
            setTargetNameMap(map);
        } catch {}
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
            await updateSchedule(workspace.id, schedule.id, { enabled: !schedule.enabled });
            setSchedules((prev) =>
                prev.map((s) => s.id === schedule.id ? { ...s, enabled: !s.enabled } : s)
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

    return (
        <TooltipProvider>
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
                                Automate tasks like a real employee
                            </p>
                        </div>
                    </div>
                    <Button onClick={handleCreate} className="gap-1.5">
                        <Plus className="h-4 w-4" />
                        New Schedule
                    </Button>
                </div>

                {/* Schedule cards */}
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
                    ) : schedules.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-center px-4 gap-3 rounded-xl border border-border/60 bg-card">
                            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                <Clock className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-sm font-medium">No schedules yet</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Create your first schedule to automate recurring tasks.
                                </p>
                            </div>
                        </div>
                    ) : (
                        schedules.map((schedule) => {
                            const desc = getScheduleDescription(schedule);
                            const tzAbbr = getTimezoneAbbr(schedule.timezone);
                            return (
                                <div key={schedule.id} className="group rounded-xl border border-border/60 bg-card px-5 py-4 transition-colors hover:bg-accent/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-sm font-semibold truncate">{schedule.name}</h3>
                                                {schedule.presetKey && (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20">
                                                        preset
                                                    </Badge>
                                                )}
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] px-1.5 py-0 ${
                                                        schedule.targetType === 'task'
                                                            ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                                                            : 'bg-purple-500/10 text-purple-600 border-purple-500/20'
                                                    }`}
                                                >
                                                    {targetNameMap[schedule.targetId] || schedule.targetType}
                                                </Badge>
                                            </div>

                                            <div className="flex items-center gap-3 flex-wrap">
                                                <p className="text-sm text-muted-foreground">
                                                    {schedule.humanizeDelay > 0 ? '~' : ''}{desc}
                                                </p>

                                                {schedule.timezone !== 'UTC' && (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                                                        <Globe className="h-2.5 w-2.5" />
                                                        {tzAbbr}
                                                    </Badge>
                                                )}

                                                {schedule.humanizeDelay > 0 && (
                                                    <Tooltip>
                                                        <TooltipTrigger>
                                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 bg-violet-500/10 text-violet-600 border-violet-500/20">
                                                                <Timer className="h-2.5 w-2.5" />
                                                                ±{schedule.humanizeDelay}min
                                                            </Badge>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Runs with up to {schedule.humanizeDelay}min random delay
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}

                                                {schedule.businessHoursOnly && (
                                                    <Tooltip>
                                                        <TooltipTrigger>
                                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                                                <Briefcase className="h-2.5 w-2.5" />
                                                                Business hours
                                                            </Badge>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            Only runs {schedule.workStartHour}:00–{schedule.workEndHour}:00 on work days
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>

                                            {schedule.nextRunDescription && schedule.enabled && (
                                                <p className="text-xs text-muted-foreground/70">
                                                    Next run: {schedule.nextRunDescription}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {togglingIds.has(schedule.id) ? (
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                            ) : (
                                                <Switch
                                                    checked={schedule.enabled}
                                                    onCheckedChange={() => handleToggleEnabled(schedule)}
                                                />
                                            )}
                                            <button
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                                                onClick={() => handleEdit(schedule)}
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
                                                        <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Delete &quot;{schedule.name}&quot;? This cannot be undone.
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
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Create/Edit Sheet */}
                {workspace && (
                    <CreateScheduleSheet
                        open={sheetOpen}
                        onOpenChange={setSheetOpen}
                        workspaceId={workspace.id}
                        schedule={editSchedule}
                        onSuccess={() => { fetchSchedules(); fetchTargetNames(); }}
                    />
                )}
            </div>
        </TooltipProvider>
    );
}
