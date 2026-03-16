'use client';

import { useEffect, useState, useMemo } from 'react';
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
import { Slider } from '@/components/ui/slider';
import { createAgent, updateAgent } from '@/lib/api/agents';
import { getProviders, type ProviderGroup } from '@/lib/api/llm';
import type { Agent } from '@/types';

const agentSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    systemPrompt: z.string().optional(),
    model: z.string().min(1, 'Model is required'),
    temperature: z.number().min(0).max(2).default(0.7),
});

type AgentFormData = z.infer<typeof agentSchema>;

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

    const [providers, setProviders] = useState<ProviderGroup[]>([]);
    const [loadingProviders, setLoadingProviders] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState<string>('');
    const [modelSearch, setModelSearch] = useState('');

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

    // Fetch providers on mount
    useEffect(() => {
        if (!open) return;

        let cancelled = false;
        setLoadingProviders(true);

        getProviders()
            .then((data) => {
                if (!cancelled) {
                    setProviders(data);
                }
            })
            .catch((err) => {
                console.error('Failed to fetch providers:', err);
                if (!cancelled) {
                    toast.error('Failed to load available models');
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingProviders(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    // Set initial provider from current model
    useEffect(() => {
        if (agent && agent.model.includes('/')) {
            const provider = agent.model.split('/')[0];
            setSelectedProvider(provider);
        }
    }, [agent]);

    // Reset form when agent changes
    useEffect(() => {
        if (agent) {
            reset({
                name: agent.name,
                systemPrompt: agent.systemPrompt ?? '',
                model: agent.model,
                temperature: agent.temperature,
            });
            if (agent.model.includes('/')) {
                setSelectedProvider(agent.model.split('/')[0]);
            }
        } else {
            reset({
                name: '',
                systemPrompt: '',
                model: '',
                temperature: 0.7,
            });
            setSelectedProvider('');
        }
        setModelSearch('');
    }, [agent, reset]);

    // Get models for selected provider, filtered by search
    const filteredModels = useMemo(() => {
        if (!selectedProvider) return [];
        const group = providers.find((p) => p.provider === selectedProvider);
        if (!group) return [];

        if (!modelSearch.trim()) return group.models;

        const q = modelSearch.toLowerCase();
        return group.models.filter(
            (m) =>
                m.name.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q)
        );
    }, [selectedProvider, providers, modelSearch]);

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

    // Format pricing for display
    const formatPrice = (priceStr: string) => {
        const price = parseFloat(priceStr);
        if (price === 0) return 'Free';
        if (price < 0.000001) return `$${(price * 1_000_000).toFixed(4)}/M`;
        return `$${(price * 1_000_000).toFixed(2)}/M`;
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-lg overflow-y-auto">
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

                    {/* Provider Selection */}
                    <div className="space-y-2">
                        <Label>Provider</Label>
                        <Select
                            value={selectedProvider}
                            onValueChange={(val) => {
                                setSelectedProvider(val);
                                setValue('model', ''); // Reset model when provider changes
                                setModelSearch('');
                            }}
                            disabled={loadingProviders}
                        >
                            <SelectTrigger id="agent-provider">
                                <SelectValue
                                    placeholder={
                                        loadingProviders
                                            ? 'Loading providers...'
                                            : 'Select provider'
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                                {providers.map((p) => (
                                    <SelectItem key={p.provider} value={p.provider}>
                                        <span className="flex items-center justify-between w-full gap-3">
                                            <span className="font-medium capitalize">
                                                {p.provider}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {p.models.length} models
                                            </span>
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Model Selection */}
                    <div className="space-y-2">
                        <Label>Model</Label>
                        {selectedProvider && (
                            <Input
                                placeholder="Search models..."
                                value={modelSearch}
                                onChange={(e) => setModelSearch(e.target.value)}
                                className="mb-2"
                            />
                        )}
                        <Select
                            value={model}
                            onValueChange={(val) => setValue('model', val)}
                            disabled={!selectedProvider || loadingProviders}
                        >
                            <SelectTrigger id="agent-model">
                                <SelectValue
                                    placeholder={
                                        !selectedProvider
                                            ? 'Select a provider first'
                                            : 'Select model'
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                                {filteredModels.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-medium text-sm">
                                                {m.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {m.context_length.toLocaleString()} ctx
                                                {' · '}
                                                In: {formatPrice(m.pricing.prompt)}
                                                {' · '}
                                                Out: {formatPrice(m.pricing.completion)}
                                            </span>
                                        </div>
                                    </SelectItem>
                                ))}
                                {selectedProvider && filteredModels.length === 0 && (
                                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                                        {modelSearch ? 'No models match your search' : 'No models available'}
                                    </div>
                                )}
                            </SelectContent>
                        </Select>
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
