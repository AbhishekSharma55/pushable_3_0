'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import cronstrue from 'cronstrue';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { createSchedule, updateSchedule } from '@/lib/api/schedules';
import { getTasks } from '@/lib/api/tasks';
import { getWorkflows } from '@/lib/api/workflows';
import type { Schedule, Task, Workflow } from '@/types';

const scheduleSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    targetType: z.enum(['task', 'workflow']),
    targetId: z.string().min(1, 'Target is required'),
    cron: z.string().min(1, 'Cron expression is required'),
    enabled: z.boolean(),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

interface CreateScheduleSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    schedule?: Schedule | null;
    onSuccess: () => void;
}

export function CreateScheduleSheet({
    open,
    onOpenChange,
    workspaceId,
    schedule,
    onSuccess,
}: CreateScheduleSheetProps) {
    const isEdit = !!schedule;
    const [tasks, setTasks] = useState<Task[]>([]);
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loadingTargets, setLoadingTargets] = useState(false);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<ScheduleFormData>({
        resolver: zodResolver(scheduleSchema),
        defaultValues: {
            name: '',
            targetType: 'task',
            targetId: '',
            cron: '',
            enabled: true,
        },
    });

    const targetType = watch('targetType');
    const enabled = watch('enabled');
    const cronValue = watch('cron');

    // Compute human-readable cron text
    let cronReadable = '';
    let cronError = false;
    if (cronValue) {
        try {
            cronReadable = cronstrue.toString(cronValue);
        } catch {
            cronReadable = 'Invalid cron expression';
            cronError = true;
        }
    }

    // Fetch tasks and workflows when sheet opens
    useEffect(() => {
        if (!open) return;
        const fetchTargets = async () => {
            setLoadingTargets(true);
            try {
                const [tasksData, workflowsData] = await Promise.all([
                    getTasks(workspaceId),
                    getWorkflows(workspaceId),
                ]);
                setTasks(tasksData);
                setWorkflows(workflowsData);
            } catch {
                toast.error('Failed to load targets');
            } finally {
                setLoadingTargets(false);
            }
        };
        fetchTargets();
    }, [open, workspaceId]);

    // Reset form when schedule changes
    useEffect(() => {
        if (schedule) {
            reset({
                name: schedule.name,
                targetType: schedule.targetType,
                targetId: schedule.targetId,
                cron: schedule.cron,
                enabled: schedule.enabled,
            });
        } else {
            reset({
                name: '',
                targetType: 'task',
                targetId: '',
                cron: '',
                enabled: true,
            });
        }
    }, [schedule, reset]);

    const onSubmit = async (data: ScheduleFormData) => {
        try {
            const payload = {
                name: data.name,
                targetType: data.targetType,
                targetId: data.targetId,
                cron: data.cron,
                enabled: data.enabled,
            };

            if (isEdit && schedule) {
                await updateSchedule(workspaceId, schedule.id, payload);
                toast.success('Schedule updated successfully');
            } else {
                await createSchedule(workspaceId, payload);
                toast.success('Schedule created successfully');
            }
            onOpenChange(false);
            onSuccess();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Something went wrong');
        }
    };

    const targetOptions = targetType === 'task' ? tasks : workflows;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-lg overflow-y-auto px-6">
                <SheetHeader>
                    <SheetTitle className="text-xl font-semibold">
                        {isEdit ? 'Edit Schedule' : 'Create Schedule'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your schedule configuration.'
                            : 'Set up a new cron-based schedule.'}
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                    {/* Name */}
                    <div className="space-y-2">
                        <Label htmlFor="schedule-name">Name</Label>
                        <Input
                            id="schedule-name"
                            placeholder="e.g. Daily report"
                            {...register('name')}
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name.message}</p>
                        )}
                    </div>

                    {/* Target Type */}
                    <div className="space-y-2">
                        <Label>Target Type</Label>
                        <Select
                            value={targetType}
                            onValueChange={(val: 'task' | 'workflow') => {
                                setValue('targetType', val);
                                setValue('targetId', '');
                            }}
                        >
                            <SelectTrigger id="schedule-target-type">
                                <SelectValue placeholder="Select target type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="task">Task</SelectItem>
                                <SelectItem value="workflow">Workflow</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Target */}
                    <div className="space-y-2">
                        <Label>Target</Label>
                        <Select
                            value={watch('targetId')}
                            onValueChange={(val: string) => setValue('targetId', val)}
                            disabled={loadingTargets}
                        >
                            <SelectTrigger id="schedule-target">
                                <SelectValue placeholder={loadingTargets ? 'Loading...' : 'Select target'} />
                            </SelectTrigger>
                            <SelectContent>
                                {targetOptions.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                        {targetType === 'task' ? (item as Task).title : (item as Workflow).name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.targetId && (
                            <p className="text-sm text-destructive">{errors.targetId.message}</p>
                        )}
                    </div>

                    {/* Cron Expression */}
                    <div className="space-y-2">
                        <Label htmlFor="schedule-cron">Cron Expression</Label>
                        <Input
                            id="schedule-cron"
                            placeholder="* * * * *"
                            {...register('cron')}
                        />
                        {cronValue && (
                            <p className={`text-xs ${cronError ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {cronReadable}
                            </p>
                        )}
                        {errors.cron && (
                            <p className="text-sm text-destructive">{errors.cron.message}</p>
                        )}
                    </div>

                    {/* Enabled */}
                    <div className="flex items-center justify-between rounded-lg border border-border/60 p-4">
                        <div>
                            <Label className="text-sm font-medium">Enabled</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Schedule will run automatically when enabled
                            </p>
                        </div>
                        <Switch
                            checked={enabled}
                            onCheckedChange={(checked) => setValue('enabled', checked)}
                        />
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={isSubmitting}
                    >
                        {isSubmitting
                            ? isEdit ? 'Updating...' : 'Creating...'
                            : isEdit ? 'Update Schedule' : 'Create Schedule'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    );
}
