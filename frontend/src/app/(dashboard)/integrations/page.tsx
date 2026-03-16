'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    Plug,
    Search,
    Trash2,
    ExternalLink,
    Loader2,
    CheckCircle,
    Plus,
    Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
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
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getToolkits,
    getIntegrations,
    connectIntegration,
    deleteIntegration,
} from '@/lib/api/integrations';
import type { Integration, Toolkit } from '@/types';

const TOOLKIT_PAGE_SIZE = 20;

export default function IntegrationsPage() {
    const workspace = useActiveWorkspace();

    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loadingIntegrations, setLoadingIntegrations] = useState(true);
    const [logoMap, setLogoMap] = useState<Record<string, string>>({});

    // Add integration dialog state
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [toolkits, setToolkits] = useState<Toolkit[]>([]);
    const [loadingToolkits, setLoadingToolkits] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    // Connect confirm dialog state
    const [connectDialogOpen, setConnectDialogOpen] = useState(false);
    const [selectedToolkit, setSelectedToolkit] = useState<Toolkit | null>(null);
    const [integrationName, setIntegrationName] = useState('');
    const [connecting, setConnecting] = useState(false);

    // Infinite scroll sentinel ref
    const sentinelRef = useRef<HTMLDivElement>(null);

    const fetchIntegrations = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoadingIntegrations(true);
            const [data, tkResult] = await Promise.all([
                getIntegrations(workspace.id),
                getToolkits({ limit: 200 }),
            ]);
            setIntegrations(data);
            const map: Record<string, string> = {};
            for (const tk of tkResult.items) {
                if (tk.logo) map[tk.slug] = tk.logo;
            }
            setLogoMap(map);
        } catch {
            toast.error('Failed to load integrations');
        } finally {
            setLoadingIntegrations(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchIntegrations();
    }, [fetchIntegrations]);

    // Fetch first page of toolkits
    const fetchToolkits = useCallback(async (query?: string) => {
        try {
            setLoadingToolkits(true);
            setToolkits([]);
            setNextCursor(null);
            const result = await getToolkits({
                search: query,
                limit: TOOLKIT_PAGE_SIZE,
            });
            setToolkits(result.items);
            setNextCursor(result.nextCursor);
        } catch {
            toast.error('Failed to load toolkits');
        } finally {
            setLoadingToolkits(false);
        }
    }, []);

    // Fetch next page
    const fetchMore = useCallback(async () => {
        if (!nextCursor || loadingMore) return;
        try {
            setLoadingMore(true);
            const result = await getToolkits({
                search: search || undefined,
                cursor: nextCursor,
                limit: TOOLKIT_PAGE_SIZE,
            });
            setToolkits((prev) => [...prev, ...result.items]);
            setNextCursor(result.nextCursor);
        } catch {
            toast.error('Failed to load more toolkits');
        } finally {
            setLoadingMore(false);
        }
    }, [nextCursor, loadingMore, search]);

    // Load first page when dialog opens
    useEffect(() => {
        if (!addDialogOpen) return;
        fetchToolkits();
    }, [addDialogOpen, fetchToolkits]);

    // Debounced search — resets to first page
    useEffect(() => {
        if (!addDialogOpen) return;
        const timeout = setTimeout(() => {
            fetchToolkits(search || undefined);
        }, 300);
        return () => clearTimeout(timeout);
    }, [search, addDialogOpen, fetchToolkits]);

    // Intersection observer for infinite scroll
    useEffect(() => {
        if (!addDialogOpen || !sentinelRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && nextCursor && !loadingMore) {
                    fetchMore();
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, [addDialogOpen, nextCursor, loadingMore, fetchMore]);

    const handleOpenAdd = () => {
        setSearch('');
        setAddDialogOpen(true);
    };

    const handleSelectToolkit = (toolkit: Toolkit) => {
        setSelectedToolkit(toolkit);
        setIntegrationName(toolkit.name);
        setAddDialogOpen(false);
        setConnectDialogOpen(true);
    };

    const handleConnect = async () => {
        if (!workspace || !selectedToolkit) return;
        try {
            setConnecting(true);
            const { connectionUrl } = await connectIntegration(
                workspace.id,
                selectedToolkit.slug,
                integrationName,
                selectedToolkit.logo || undefined,
            );
            window.location.href = connectionUrl;
        } catch {
            toast.error('Failed to start connection');
            setConnecting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteIntegration(workspace.id, id);
            toast.success('Integration deleted');
            fetchIntegrations();
        } catch {
            toast.error('Failed to delete integration');
        }
    };

    const statusBadge = (status: Integration['status']) => {
        switch (status) {
            case 'active':
                return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
            case 'pending':
                return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
            case 'failed':
                return 'bg-red-500/10 text-red-600 border-red-500/20';
            default:
                return 'bg-muted text-muted-foreground';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                        <Plug className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
                        <p className="text-sm text-muted-foreground">
                            Connected third-party services
                        </p>
                    </div>
                </div>
                <Button onClick={handleOpenAdd} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Integration
                </Button>
            </div>

            {/* Connected Integrations List */}
            {loadingIntegrations ? (
                <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-lg border border-border/60 bg-card px-4 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-10 w-10 rounded-lg" />
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-20" />
                                </div>
                            </div>
                            <Skeleton className="h-8 w-8" />
                        </div>
                    ))}
                </div>
            ) : integrations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[calc(100vh-280px)] text-center gap-4">
                    <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 flex items-center justify-center">
                        <Sparkles className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <div>
                        <p className="text-lg font-medium text-muted-foreground">
                            No integrations connected
                        </p>
                        <p className="text-sm text-muted-foreground/70 mt-1">
                            Click &quot;Add Integration&quot; to connect apps like GitHub, Gmail, Slack, and more.
                        </p>
                    </div>
                    <Button variant="outline" onClick={handleOpenAdd} className="gap-1.5 mt-2">
                        <Plus className="h-4 w-4" />
                        Add Integration
                    </Button>
                </div>
            ) : (
                <div className="space-y-2">
                    {integrations.map((integration) => (
                        <div
                            key={integration.id}
                            className="rounded-lg border border-border/60 bg-card px-4 py-4 flex items-center justify-between"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted flex-shrink-0 overflow-hidden">
                                    {(() => {
                                        const logo = (integration.metadata as Record<string, unknown>)?.logo as string
                                            || logoMap[integration.composioToolkitSlug];
                                        return logo ? (
                                            <img
                                                src={logo}
                                                alt={integration.name}
                                                className="h-10 w-10 rounded-lg object-contain"
                                            />
                                        ) : (
                                            <Plug className="h-5 w-5 text-violet-600" />
                                        );
                                    })()}
                                </div>
                                <div>
                                    <p className="text-sm font-medium">{integration.name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                                            {integration.composioToolkitSlug}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] px-1.5 py-0 ${statusBadge(integration.status)}`}
                                        >
                                            {integration.status}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <button className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Delete Integration</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Are you sure you want to delete &quot;{integration.name}&quot;? This will disconnect the service and cannot be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={() => handleDelete(integration.id)}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                            Delete
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Integration Dialog — toolkit browser with infinite scroll */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Add Integration</DialogTitle>
                        <DialogDescription>
                            Browse and connect third-party services to your workspace.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search integrations..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    {/* Scrollable toolkit grid */}
                    <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
                        {loadingToolkits ? (
                            <div className="grid grid-cols-2 gap-3 py-2">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                                        <Skeleton className="h-7 w-7 rounded" />
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-3 w-full" />
                                    </div>
                                ))}
                            </div>
                        ) : toolkits.length === 0 ? (
                            <div className="flex h-40 items-center justify-center">
                                <p className="text-sm text-muted-foreground">No integrations found.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3 py-2">
                                {toolkits.map((toolkit) => {
                                    const alreadyConnected = integrations.some(
                                        (i) => i.composioToolkitSlug === toolkit.slug && i.status === 'active'
                                    );
                                    return (
                                        <button
                                            key={toolkit.slug}
                                            className="rounded-lg border border-border/60 bg-card p-3 flex items-start gap-3 text-left hover:bg-accent transition-colors"
                                            onClick={() => handleSelectToolkit(toolkit)}
                                        >
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                                                {toolkit.logo ? (
                                                    <img
                                                        src={toolkit.logo}
                                                        alt={toolkit.name}
                                                        className="h-8 w-8 rounded-lg object-contain"
                                                    />
                                                ) : (
                                                    <Plug className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium truncate">{toolkit.name}</p>
                                                    {alreadyConnected && (
                                                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                                    {toolkit.description}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}

                                {/* Infinite scroll sentinel */}
                                {nextCursor && (
                                    <div
                                        ref={sentinelRef}
                                        className="col-span-2 flex items-center justify-center py-4"
                                    >
                                        {loadingMore ? (
                                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Scroll for more</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Connect Confirm Dialog */}
            <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Connect {selectedToolkit?.name}
                        </DialogTitle>
                        <DialogDescription>
                            You&apos;ll be redirected to {selectedToolkit?.name} to authorize access.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <label className="text-sm font-medium mb-2 block">
                            Integration Name
                        </label>
                        <Input
                            value={integrationName}
                            onChange={(e) => setIntegrationName(e.target.value)}
                            placeholder="Enter a name for this integration"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setConnectDialogOpen(false);
                                setAddDialogOpen(true);
                            }}
                            disabled={connecting}
                        >
                            Back
                        </Button>
                        <Button
                            onClick={handleConnect}
                            disabled={connecting || !integrationName.trim()}
                            className="gap-1.5"
                        >
                            {connecting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <ExternalLink className="h-4 w-4" />
                            )}
                            Continue to {selectedToolkit?.name}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
