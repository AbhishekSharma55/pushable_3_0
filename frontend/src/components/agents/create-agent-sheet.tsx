'use client';

import { useEffect } from 'react';
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
import { Slider } from '@/components/ui/slider';
import { createAgent, updateAgent } from '@/lib/api/agents';
import { ModelPicker } from '@/components/model-picker';
import type { Agent } from '@/types';

const agentSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    systemPrompt: z.string().optional(),
    model: z.string().min(1, 'Model is required'),
    temperature: z.number().min(0).max(2).default(0.7),
});

type AgentFormData = z.input<typeof agentSchema>;

interface CreateAgentSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    agent?: Agent | null;
    onSuccess: () => void;
}

export function CreateAgentSheet({
    open,
    onOpenChange,
    workspaceId,
    agent,
    onSuccess,
}: CreateAgentSheetProps) {
    const isEdit = !!agent;

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<AgentFormData>({
        resolver: zodResolver(agentSchema),
        defaultValues: {
            name: '',
            systemPrompt: '',
            model: '',
            temperature: 0.7,
        },
    });

    const temperature = watch('temperature');
    const model = watch('model');

    // Reset form when agent changes
    useEffect(() => {
        if (agent) {
            reset({
                name: agent.name,
                systemPrompt: agent.systemPrompt ?? '',
                model: agent.model,
                temperature: agent.temperature,
            });
        } else {
            reset({
                name: '',
                systemPrompt: '',
                model: '',
                temperature: 0.7,
            });
        }
    }, [agent, reset]);

    const onSubmit = async (data: AgentFormData) => {
        try {
            if (isEdit && agent) {
                await updateAgent(workspaceId, agent.id, data);
                toast.success('Agent updated successfully');
            } else {
                await createAgent(workspaceId, data);
                toast.success('Agent created successfully');
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
            <SheetContent className="sm:max-w-xl md:max-w-2xl lg:max-w-3xl overflow-y-auto px-6">
                <SheetHeader>
                    <SheetTitle className="text-xl font-semibold">
                        {isEdit ? 'Edit Agent' : 'Create Agent'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your agent configuration.'
                            : 'Configure a new AI agent for your workspace.'}
                    </SheetDescription>
                </SheetHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                    {/* Name */}
                    <div className="space-y-2">
                        <Label htmlFor="agent-name">Name</Label>
                        <Input
                            id="agent-name"
                            placeholder="e.g. Customer Support Agent"
                            {...register('name')}
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name.message}</p>
                        )}
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-2">
                        <Label htmlFor="agent-prompt">System Prompt</Label>
                        <Textarea
                            id="agent-prompt"
                            placeholder="You are a helpful assistant..."
                            rows={5}
                            className="resize-none"
                            {...register('systemPrompt')}
                        />
                    </div>

                    {/* Model Selection */}
                    <div className="space-y-2">
                        <Label>Model</Label>
                        {open && (
                            <ModelPicker
                                value={model}
                                onChange={(val) => setValue('model', val)}
                            />
                        )}
                        {errors.model && (
                            <p className="text-sm text-destructive">{errors.model.message}</p>
                        )}
                    </div>

                    {/* Temperature */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label>Temperature</Label>
                            <span className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                {temperature?.toFixed(1)}
                            </span>
                        </div>
                        <Slider
                            id="agent-temperature"
                            min={0}
                            max={2}
                            step={0.1}
                            value={[temperature ?? 0.7]}
                            onValueChange={([val]) => setValue('temperature', val)}
                            className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Precise</span>
                            <span>Creative</span>
                        </div>
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={isSubmitting}
                    >
                        {isSubmitting
                            ? isEdit ? 'Updating...' : 'Creating...'
                            : isEdit ? 'Update Agent' : 'Create Agent'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    );
}
