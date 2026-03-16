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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { createTool, updateTool } from '@/lib/api/tools';
import type { Tool } from '@/types';

const toolSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    type: z.enum(['mcp', 'function']),
    isGlobal: z.boolean().default(false),
    webhookUrl: z.string().optional(),
    mcpUrl: z.string().optional(),
    mcpApiKey: z.string().optional(),
    mcpToolNames: z.string().optional(),
});

type ToolFormData = z.infer<typeof toolSchema>;

interface CreateToolSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    tool?: Tool | null;
    onSuccess: () => void;
}

export function CreateToolSheet({
    open,
    onOpenChange,
    workspaceId,
    tool,
    onSuccess,
}: CreateToolSheetProps) {
    const isEdit = !!tool;

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<ToolFormData>({
        resolver: zodResolver(toolSchema),
        defaultValues: {
            name: '',
            description: '',
            type: 'function',
            isGlobal: false,
            webhookUrl: '',
            mcpUrl: '',
            mcpApiKey: '',
            mcpToolNames: '',
        },
    });

    const toolType = watch('type');
    const isGlobal = watch('isGlobal');

    useEffect(() => {
        if (tool) {
            const config = tool.config as Record<string, unknown>;
            reset({
                name: tool.name,
                description: tool.description ?? '',
                type: tool.type,
                isGlobal: tool.isGlobal,
                webhookUrl: (config.webhookUrl as string) ?? '',
                mcpUrl: (config.url as string) ?? '',
                mcpApiKey: (config.apiKey as string) ?? '',
                mcpToolNames: Array.isArray(config.toolNames)
                    ? (config.toolNames as string[]).join(', ')
                    : '',
            });
        } else {
            reset({
                name: '',
                description: '',
                type: 'function',
                isGlobal: false,
                webhookUrl: '',
                mcpUrl: '',
                mcpApiKey: '',
                mcpToolNames: '',
            });
        }
    }, [tool, reset]);

    const onSubmit = async (data: ToolFormData) => {
        try {
            const config: Record<string, unknown> = {};

            if (data.type === 'function') {
                config.webhookUrl = data.webhookUrl;
            } else {
                config.url = data.mcpUrl;
                if (data.mcpApiKey) config.apiKey = data.mcpApiKey;
                if (data.mcpToolNames) {
                    config.toolNames = data.mcpToolNames
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                }
            }

            const payload = {
                name: data.name,
                description: data.description,
                type: data.type,
                isGlobal: data.isGlobal,
                config,
            };

            if (isEdit && tool) {
                await updateTool(workspaceId, tool.id, payload);
                toast.success('Tool updated successfully');
            } else {
                await createTool(workspaceId, payload);
                toast.success('Tool created successfully');
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
            <SheetContent className="sm:max-w-lg overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="text-xl font-semibold">
                        {isEdit ? 'Edit Tool' : 'Create Tool'}
                    </SheetTitle>
                    <SheetDescription>
                        {isEdit
                            ? 'Update your tool configuration.'
                            : 'Connect a new tool to your workspace.'}
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6 px-1">
                    {/* Name */}
                    <div className="space-y-2">
                        <Label htmlFor="tool-name">Name</Label>
                        <Input
                            id="tool-name"
                            placeholder="e.g. Weather API"
                            {...register('name')}
                        />
                        {errors.name && (
                            <p className="text-sm text-destructive">{errors.name.message}</p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label htmlFor="tool-description">Description</Label>
                        <Textarea
                            id="tool-description"
                            placeholder="What does this tool do?"
                            rows={3}
                            className="resize-none"
                            {...register('description')}
                        />
                    </div>

                    {/* Type */}
                    <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                            value={toolType}
                            onValueChange={(val: 'mcp' | 'function') => setValue('type', val)}
                        >
                            <SelectTrigger id="tool-type">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="function">Function (Webhook)</SelectItem>
                                <SelectItem value="mcp">MCP Server</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Dynamic config fields */}
                    {toolType === 'function' && (
                        <div className="space-y-2">
                            <Label htmlFor="tool-webhook-url">Webhook URL</Label>
                            <Input
                                id="tool-webhook-url"
                                placeholder="https://api.example.com/webhook"
                                {...register('webhookUrl')}
                            />
                        </div>
                    )}

                    {toolType === 'mcp' && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="tool-mcp-url">Server URL</Label>
                                <Input
                                    id="tool-mcp-url"
                                    placeholder="https://mcp-server.example.com/sse"
                                    {...register('mcpUrl')}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tool-mcp-api-key">API Key (optional)</Label>
                                <Input
                                    id="tool-mcp-api-key"
                                    type="password"
                                    placeholder="sk-..."
                                    {...register('mcpApiKey')}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tool-mcp-tool-names">Tool Names (optional, comma-separated)</Label>
                                <Input
                                    id="tool-mcp-tool-names"
                                    placeholder="search, fetch_data"
                                    {...register('mcpToolNames')}
                                />
                            </div>
                        </>
                    )}

                    {/* Is Global */}
                    <div className="flex items-center justify-between rounded-lg border border-border/60 p-4">
                        <div>
                            <Label className="text-sm font-medium">Global Tool</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Available across all workspaces
                            </p>
                        </div>
                        <Switch
                            checked={isGlobal}
                            onCheckedChange={(checked) => setValue('isGlobal', checked)}
                        />
                    </div>

                    <Button
                        type="submit"
                        className="w-full"
                        disabled={isSubmitting}
                    >
                        {isSubmitting
                            ? isEdit ? 'Updating...' : 'Creating...'
                            : isEdit ? 'Update Tool' : 'Create Tool'}
                    </Button>
                </form>
            </SheetContent>
        </Sheet>
    );
}
