'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { createTask, updateTask } from '@/lib/api/tasks';
import { getAgents } from '@/lib/api/agents';
import type { Task, Agent } from '@/types';

const taskSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    agentId: z.string().min(1, 'Agent is required'),
});

type TaskFormData = z.infer<typeof taskSchema>;

interface CreateTaskSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    task?: Task | null;
    onSuccess: () => void;
}

export function CreateTaskSheet({
    open,
    onOpenChange,
    workspaceId,
    task,
    onSuccess,
}: CreateTaskSheetProps) {
    const isEdit = !!task;
    const [agents, setAgents] = useState<Agent[]>([]);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<TaskFormData>({
        resolver: zodResolver(taskSchema),
        defaultValues: {
            title: '',
            description: '',
            agentId: '',
        },
    });

    const agentId = watch('agentId');

    // Fetch agents on mount
    useEffect(() => {
        if (!workspaceId) return;
        getAgents(workspaceId)
            .then(setAgents)
            .catch(() => {
                /* silently ignore */
            });
    }, [workspaceId]);

    // Reset form when task changes (edit vs create)
    useEffect(() => {
        if (task) {
            reset({
                title: task.title,
                description: task.description ?? '',
                agentId: task.agentId,
            });
        } else {
            reset({
                title: '',
                description: '',
                agentId: '',
            });
        }
    }, [task, reset]);

    const onSubmit = async (data: TaskFormData) => {
        try {
            const payload = {
                title: data.title,
                description: data.description,
                agentId: data.agentId,
            };

            if (isEdit && task) {
                await updateTask(workspaceId, task.id, payload);
                toast.success('Task updated successfully');
            } else {
                await createTask(workspaceId, payload);
                toast.success('Task created successfully');
            }
            onOpenChange(false);
            onSuccess();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Something went wrong');
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-lg overflow-y-auto px-6">
                <SheetHeader>
                    <SheetTitle className="text-xl font-semibold">
                        {isEdit ? 'Edit Task' : 'Create Task'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your task configuration.'
                            : 'Create a new task for an agent to execute.'}
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                    {/* Title */}
                    <div className="space-y-2">
                        <Label htmlFor="task-title">Title</Label>
                        <Input
                            id="task-title"
                            placeholder="e.g. Summarize weekly report"
                            {...register('title')}
                        />
                        {errors.title && (
                            <p className="text-sm text-destructive">{errors.title.message}</p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label htmlFor="task-description">Description (optional)</Label>
                        <Textarea
                            id="task-description"
                            placeholder="What should the agent do?"
                            rows={3}
                            className="resize-none"
                            {...register('description')}
                        />
                    </div>

                    {/* Agent */}
                    <div className="space-y-2">
                        <Label>Agent</Label>
                        <Select
                            value={agentId}
                            onValueChange={(val: string) => setValue('agentId', val)}
                        >
                            <SelectTrigger id="task-agent">
                                <SelectValue placeholder="Select an agent" />
                            </SelectTrigger>
                            <SelectContent>
                                {agents.map((agent) => (
                                    <SelectItem key={agent.id} value={agent.id}>
                                        {agent.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.agentId && (
                            <p className="text-sm text-destructive">{errors.agentId.message}</p>
                        )}
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={isSubmitting}
                    >
                        {isSubmitting
                            ? isEdit ? 'Updating...' : 'Creating...'
                            : isEdit ? 'Update Task' : 'Create Task'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    );
}
