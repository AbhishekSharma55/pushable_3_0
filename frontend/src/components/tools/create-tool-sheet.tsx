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
    isGlobal: z.boolean(),
    webhookUrl: z.string().optional(),
    httpMethod: z.enum(['GET', 'POST']),
    mcpUrl: z.string().optional(),
    mcpApiKey: z.string().optional(),
    mcpToolNames: z.string().optional(),
});

/** Extract {{var}} names from a URL template */
function extractUrlVars(url: string): string[] {
    const matches = url.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

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
            httpMethod: 'POST',
            mcpUrl: '',
            mcpApiKey: '',
            mcpToolNames: '',
        },
    });

    const toolType = watch('type');
    const isGlobal = watch('isGlobal');
    const webhookUrl = watch('webhookUrl');
    const httpMethod = watch('httpMethod');

    const detectedVars = extractUrlVars(webhookUrl || '');

    useEffect(() => {
        if (tool) {
            const config = tool.config as Record<string, unknown>;
            reset({
                name: tool.name,
                description: tool.description ?? '',
                type: tool.type,
                isGlobal: tool.isGlobal,
                webhookUrl: (config.webhookUrl as string) ?? '',
                httpMethod: ((config.method as string) || 'POST') as 'GET' | 'POST',
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
                httpMethod: 'POST',
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
                config.method = data.httpMethod;
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
            <SheetContent className="sm:max-w-lg overflow-y-auto px-6">
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
                        <>
                            <div className="space-y-2">
                                <Label>HTTP Method</Label>
                                <Select
                                    value={httpMethod}
                                    onValueChange={(val: 'GET' | 'POST') => setValue('httpMethod', val)}
                                >
                                    <SelectTrigger id="tool-http-method">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="GET">GET</SelectItem>
                                        <SelectItem value="POST">POST</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="tool-webhook-url">Webhook URL</Label>
                                <Input
                                    id="tool-webhook-url"
                                    placeholder="https://api.example.com/weather/{{city}}"
                                    {...register('webhookUrl')}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Use <code className="px-1 py-0.5 rounded bg-muted text-[11px]">{'{{variable}}'}</code> for dynamic parameters the AI will fill at runtime.
                                </p>
                            </div>

                            {detectedVars.length > 0 && (
                                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                                    <p className="text-xs font-medium text-blue-600 mb-1.5">
                                        Detected variables
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {detectedVars.map((v) => (
                                            <span
                                                key={v}
                                                className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-mono text-blue-700 ring-1 ring-blue-500/20"
                                            >
                                                {v}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground mt-1.5">
                                        The AI agent will provide values for these when calling this tool.
                                    </p>
                                </div>
                            )}
                        </>
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
