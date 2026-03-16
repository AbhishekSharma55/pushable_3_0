'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Wrench,
    Plus,
    Trash2,
    Pencil,
    Globe,
    Sparkles,
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
import { CreateToolSheet } from '@/components/tools/create-tool-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getTools, deleteTool } from '@/lib/api/tools';
import type { Tool } from '@/types';

export default function ToolsPage() {
    const workspace = useActiveWorkspace();
    const [tools, setTools] = useState<Tool[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editTool, setEditTool] = useState<Tool | null>(null);

    const fetchTools = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getTools(workspace.id);
            setTools(data);
        } catch {
            toast.error('Failed to load tools');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchTools();
    }, [fetchTools]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteTool(workspace.id, id);
            toast.success('Tool deleted');
            if (selectedTool?.id === id) setSelectedTool(null);
            fetchTools();
        } catch {
            toast.error('Failed to delete tool');
        }
    };

    const handleEdit = (tool: Tool) => {
        setEditTool(tool);
        setSheetOpen(true);
    };

    const handleCreate = () => {
        setEditTool(null);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchTools();
        setSelectedTool(null);
    };

    const typeBadge = (type: string) => {
        if (type === 'function')
            return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    };

    const maskValue = (value: string) => {
        if (!value || value.length <= 8) return '********';
        return value.slice(0, 4) + '****' + value.slice(-4);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                    <Wrench className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Tools</h1>
                    <p className="text-sm text-muted-foreground">
                        Connect MCP servers and custom functions
                    </p>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-6 h-[calc(100vh-200px)]">
                {/* Left panel — Tool list */}
                <div className="w-[320px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-4 border-b border-border/60 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Tools
                        </h2>
                        <Button
                            size="sm"
                            onClick={handleCreate}
                            className="gap-1.5"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New Tool
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
                        ) : tools.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">No tools yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Create your first tool to extend agent capabilities.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            tools.map((tool) => (
                                <div
                                    key={tool.id}
                                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer transition-all duration-150 hover:bg-accent ${
                                        selectedTool?.id === tool.id
                                            ? 'bg-accent ring-1 ring-border'
                                            : ''
                                    }`}
                                    onClick={() => setSelectedTool(tool)}
                                >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-cyan-500/15 flex-shrink-0">
                                        <Wrench className="h-4 w-4 text-blue-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {tool.name}
                                        </p>
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 py-0 ${typeBadge(tool.type)}`}
                                            >
                                                {tool.type}
                                            </Badge>
                                            {tool.isGlobal && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20"
                                                >
                                                    <Globe className="h-2.5 w-2.5 mr-0.5" />
                                                    global
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
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
                                                <AlertDialogTitle>Delete Tool</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Are you sure you want to delete &quot;{tool.name}&quot;? This action cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDelete(tool.id)}
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

                {/* Right panel — Tool detail */}
                <div className="flex-1 rounded-xl border border-border/60 bg-card overflow-hidden">
                    {selectedTool ? (
                        <div className="h-full flex flex-col">
                            {/* Tool header */}
                            <div className="p-6 border-b border-border/60">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20">
                                            <Wrench className="h-7 w-7 text-blue-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold">{selectedTool.name}</h2>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-xs ${typeBadge(selectedTool.type)}`}
                                                >
                                                    {selectedTool.type === 'function' ? 'Function (Webhook)' : 'MCP Server'}
                                                </Badge>
                                                {selectedTool.isGlobal && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20"
                                                    >
                                                        <Globe className="h-3 w-3 mr-1" />
                                                        Global
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleEdit(selectedTool)}
                                        className="gap-1.5"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                        Edit
                                    </Button>
                                </div>
                            </div>

                            {/* Tool details */}
                            <div className="flex-1 p-6 overflow-y-auto space-y-6">
                                {selectedTool.description && (
                                    <div>
                                        <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                            Description
                                        </h3>
                                        <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                            <p className="text-sm leading-relaxed">
                                                {selectedTool.description}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                        Configuration
                                    </h3>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4 space-y-3">
                                        {selectedTool.type === 'function' && (
                                            <div>
                                                <p className="text-xs font-medium text-muted-foreground">Webhook URL</p>
                                                <p className="text-sm font-mono mt-0.5">
                                                    {(selectedTool.config as Record<string, unknown>).webhookUrl as string || 'Not configured'}
                                                </p>
                                            </div>
                                        )}
                                        {selectedTool.type === 'mcp' && (
                                            <>
                                                <div>
                                                    <p className="text-xs font-medium text-muted-foreground">Server URL</p>
                                                    <p className="text-sm font-mono mt-0.5">
                                                        {(selectedTool.config as Record<string, unknown>).url as string || 'Not configured'}
                                                    </p>
                                                </div>
                                                {(selectedTool.config as Record<string, unknown>).apiKey && (
                                                    <div>
                                                        <p className="text-xs font-medium text-muted-foreground">API Key</p>
                                                        <p className="text-sm font-mono mt-0.5">
                                                            {maskValue((selectedTool.config as Record<string, unknown>).apiKey as string)}
                                                        </p>
                                                    </div>
                                                )}
                                                {Array.isArray((selectedTool.config as Record<string, unknown>).toolNames) &&
                                                    ((selectedTool.config as Record<string, unknown>).toolNames as string[]).length > 0 && (
                                                    <div>
                                                        <p className="text-xs font-medium text-muted-foreground">Tool Names</p>
                                                        <p className="text-sm font-mono mt-0.5">
                                                            {((selectedTool.config as Record<string, unknown>).toolNames as string[]).join(', ')}
                                                        </p>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Created</p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedTool.createdAt).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Last Updated</p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedTool.updatedAt).toLocaleDateString('en-US', {
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
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500/10 to-cyan-500/10 flex items-center justify-center">
                                <Wrench className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">
                                    Select a tool
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Choose a tool from the list to view details and configuration.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit Sheet */}
            {workspace && (
                <CreateToolSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    tool={editTool}
                    onSuccess={handleSheetSuccess}
                />
            )}
        </div>
    );
}
