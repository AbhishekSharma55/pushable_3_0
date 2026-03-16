'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Bot,
    Plus,
    Trash2,
    MessageSquare,
    Pencil,
    Cpu,
    Thermometer,
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
import { CreateAgentSheet } from '@/components/agents/create-agent-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getAgents, deleteAgent } from '@/lib/api/agents';
import type { Agent } from '@/types';

export default function AgentsPage() {
    const workspace = useActiveWorkspace();
    const router = useRouter();
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editAgent, setEditAgent] = useState<Agent | null>(null);

    const fetchAgents = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getAgents(workspace.id);
            setAgents(data);
        } catch {
            toast.error('Failed to load agents');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchAgents();
    }, [fetchAgents]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteAgent(workspace.id, id);
            toast.success('Agent deleted');
            if (selectedAgent?.id === id) setSelectedAgent(null);
            fetchAgents();
        } catch {
            toast.error('Failed to delete agent');
        }
    };

    const handleEdit = (agent: Agent) => {
        setEditAgent(agent);
        setSheetOpen(true);
    };

    const handleCreate = () => {
        setEditAgent(null);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchAgents();
        setSelectedAgent(null);
    };

    const modelColor = (model: string) => {
        if (model.includes('gpt-4o-mini')) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
        if (model.includes('gpt-4o')) return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
        if (model.includes('gpt-4')) return 'bg-violet-500/10 text-violet-600 border-violet-500/20';
        if (model.includes('claude')) return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
        return 'bg-muted text-muted-foreground';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                    <Bot className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
                    <p className="text-sm text-muted-foreground">
                        Create and manage your AI employees
                    </p>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-6 h-[calc(100vh-200px)]">
                {/* Left panel — Agent list */}
                <div className="w-[320px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-4 border-b border-border/60 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Agents
                        </h2>
                        <Button
                            size="sm"
                            onClick={handleCreate}
                            className="gap-1.5"
                            id="create-agent-btn"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New Agent
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
                        ) : agents.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">No agents yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Create your first agent to get started.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            agents.map((agent) => (
                                <div
                                    key={agent.id}
                                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer transition-all duration-150 hover:bg-accent ${selectedAgent?.id === agent.id
                                            ? 'bg-accent ring-1 ring-border'
                                            : ''
                                        }`}
                                    onClick={() => setSelectedAgent(agent)}
                                    id={`agent-item-${agent.id}`}
                                >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-blue-500/15 flex-shrink-0">
                                        <Bot className="h-4 w-4 text-violet-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {agent.name}
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] px-1.5 py-0 mt-1 ${modelColor(agent.model)}`}
                                        >
                                            {agent.model}
                                        </Badge>
                                    </div>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => e.stopPropagation()}
                                                id={`delete-agent-${agent.id}`}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Are you sure you want to delete &quot;{agent.name}&quot;? This action cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDelete(agent.id)}
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

                {/* Right panel — Agent detail */}
                <div className="flex-1 rounded-xl border border-border/60 bg-card overflow-hidden">
                    {selectedAgent ? (
                        <div className="h-full flex flex-col">
                            {/* Agent header */}
                            <div className="p-6 border-b border-border/60">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                                            <Bot className="h-7 w-7 text-violet-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold">{selectedAgent.name}</h2>
                                            <div className="flex items-center gap-3 mt-1.5">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-xs ${modelColor(selectedAgent.model)}`}
                                                >
                                                    <Cpu className="h-3 w-3 mr-1" />
                                                    {selectedAgent.model}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs bg-muted/50">
                                                    <Thermometer className="h-3 w-3 mr-1" />
                                                    {selectedAgent.temperature}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleEdit(selectedAgent)}
                                            className="gap-1.5"
                                            id="edit-agent-btn"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                            Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => router.push(`/agents/${selectedAgent.id}/chat`)}
                                            className="gap-1.5 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700"
                                            id="open-chat-btn"
                                        >
                                            <MessageSquare className="h-3.5 w-3.5" />
                                            Open Chat
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Agent details */}
                            <div className="flex-1 p-6 overflow-y-auto space-y-6">
                                <div>
                                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                        System Prompt
                                    </h3>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                            {selectedAgent.systemPrompt || (
                                                <span className="text-muted-foreground italic">
                                                    No system prompt configured. Using default: &quot;You are a helpful assistant.&quot;
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">
                                            Created
                                        </p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedAgent.createdAt).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">
                                            Last Updated
                                        </p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedAgent.updatedAt).toLocaleDateString('en-US', {
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
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center">
                                <Bot className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">
                                    Select an agent
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Choose an agent from the list to view details and start chatting.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit Sheet */}
            {workspace && (
                <CreateAgentSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    agent={editAgent}
                    onSuccess={handleSheetSuccess}
                />
            )}
        </div>
    );
}
