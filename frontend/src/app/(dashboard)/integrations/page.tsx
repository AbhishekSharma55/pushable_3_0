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
    Pencil,
    Shield,
    Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
    updateIntegration,
    getToolkitActions,
    updateToolPermissions,
} from '@/lib/api/integrations';
import type { ToolkitAction, ToolPermissions } from '@/lib/api/integrations';
import { getVaultStatus, connectVault, disconnectVault } from '@/lib/api/vault';
import type { VaultStatus } from '@/lib/api/vault';
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
    const [connectionLabel, setConnectionLabel] = useState('');
    const [connectionDescription, setConnectionDescription] = useState('');
    const [connecting, setConnecting] = useState(false);

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editingIntegration, setEditingIntegration] = useState<Integration | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [saving, setSaving] = useState(false);

    // Permissions dialog state
    const [permDialogOpen, setPermDialogOpen] = useState(false);
    const [permIntegration, setPermIntegration] = useState<Integration | null>(null);
    const [actions, setActions] = useState<ToolkitAction[]>([]);
    const [loadingActions, setLoadingActions] = useState(false);
    const [permMode, setPermMode] = useState<'allowlist' | 'blocklist'>('blocklist');
    const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
    const [savingPerms, setSavingPerms] = useState(false);
    const [actionSearch, setActionSearch] = useState('');

    // Bitwarden state
    const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
    const [bitwardenDialogOpen, setBitwardenDialogOpen] = useState(false);
    const [bitwardenEmail, setBitwardenEmail] = useState('');
    const [bitwardenPassword, setBitwardenPassword] = useState('');
    const [bitwardenCode, setBitwardenCode] = useState('');
    const [bitwardenCodeRequired, setBitwardenCodeRequired] = useState(false);
    const [bitwardenConnecting, setBitwardenConnecting] = useState(false);

    // Infinite scroll sentinel ref
    const sentinelRef = useRef<HTMLDivElement>(null);

    const fetchIntegrations = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoadingIntegrations(true);
            const [data, tkResult, vaultData] = await Promise.all([
                getIntegrations(workspace.id),
                getToolkits({ limit: 200 }),
                getVaultStatus(workspace.id).catch(() => null),
            ]);
            setIntegrations(data);
            if (vaultData) setVaultStatus(vaultData);
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
        setConnectionLabel('');
        setConnectionDescription('');
        setAddDialogOpen(false);
        setConnectDialogOpen(true);
    };

    const handleConnect = async () => {
        if (!workspace || !selectedToolkit) return;
        if (connectionLabel.trim().length < 2) {
            toast.error('Connection name must be at least 2 characters');
            return;
        }
        try {
            setConnecting(true);
            const { connectionUrl } = await connectIntegration(workspace.id, {
                toolkitSlug: selectedToolkit.slug,
                name: integrationName,
                connectionLabel: connectionLabel.trim(),
                connectionDescription: connectionDescription.trim() || undefined,
                logo: selectedToolkit.logo || undefined,
            });
            window.location.href = connectionUrl;
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Failed to start connection';
            // Check for duplicate label error from API
            if (typeof (error as Record<string, unknown>)?.response === 'object') {
                const resp = (error as { response?: { data?: { message?: string } } }).response;
                if (resp?.data?.message) {
                    toast.error(resp.data.message);
                    setConnecting(false);
                    return;
                }
            }
            toast.error(msg);
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

    const handleEdit = (integration: Integration) => {
        setEditingIntegration(integration);
        setEditLabel(integration.connectionLabel || integration.name);
        setEditDescription(integration.connectionDescription || '');
        setEditDialogOpen(true);
    };

    const handleSaveEdit = async () => {
        if (!workspace || !editingIntegration) return;
        if (editLabel.trim().length < 2) {
            toast.error('Connection name must be at least 2 characters');
            return;
        }
        try {
            setSaving(true);
            await updateIntegration(workspace.id, editingIntegration.id, {
                connectionLabel: editLabel.trim(),
                connectionDescription: editDescription.trim() || undefined,
            });
            toast.success('Connection updated');
            setEditDialogOpen(false);
            fetchIntegrations();
        } catch (error) {
            const resp = (error as { response?: { data?: { message?: string } } }).response;
            if (resp?.data?.message) {
                toast.error(resp.data.message);
            } else {
                toast.error('Failed to update connection');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleOpenPermissions = async (integration: Integration) => {
        setPermIntegration(integration);
        setActionSearch('');

        // Load existing permissions from metadata
        const existing = (integration.metadata as Record<string, unknown>)?.toolPermissions as ToolPermissions | undefined;
        if (existing) {
            setPermMode(existing.mode);
            setSelectedTools(new Set(existing.tools));
        } else {
            setPermMode('blocklist');
            setSelectedTools(new Set());
        }

        setPermDialogOpen(true);
        setLoadingActions(true);

        try {
            const result = await getToolkitActions(integration.composioToolkitSlug);
            setActions(result);
        } catch {
            toast.error('Failed to load available actions');
        } finally {
            setLoadingActions(false);
        }
    };

    const handleSelectAllTools = () => {
        const filtered = actions.filter(a =>
            !actionSearch || a.slug.toLowerCase().includes(actionSearch.toLowerCase()) || a.name.toLowerCase().includes(actionSearch.toLowerCase())
        );
        const allSelected = filtered.every(a => selectedTools.has(a.slug));
        setSelectedTools(prev => {
            const next = new Set(prev);
            if (allSelected) {
                for (const a of filtered) next.delete(a.slug);
            } else {
                for (const a of filtered) next.add(a.slug);
            }
            return next;
        });
    };

    const handleToggleTool = (slug: string) => {
        setSelectedTools(prev => {
            const next = new Set(prev);
            if (next.has(slug)) {
                next.delete(slug);
            } else {
                next.add(slug);
            }
            return next;
        });
    };

    const handleSavePermissions = async () => {
        if (!workspace || !permIntegration) return;
        try {
            setSavingPerms(true);
            await updateToolPermissions(workspace.id, permIntegration.id, {
                mode: permMode,
                tools: Array.from(selectedTools),
            });
            toast.success('Tool permissions updated');
            setPermDialogOpen(false);
            fetchIntegrations();
        } catch {
            toast.error('Failed to update permissions');
        } finally {
            setSavingPerms(false);
        }
    };

    const handleSelectBitwarden = () => {
        console.log('🔐 Bitwarden button clicked');
        setBitwardenDialogOpen(true);
        console.log('🔐 Set bitwardenDialogOpen to true');
        setAddDialogOpen(false);
        console.log('🔐 Set addDialogOpen to false');
        setBitwardenEmail('');
        setBitwardenPassword('');
        setBitwardenCode('');
        setBitwardenCodeRequired(false);
        console.log('🔐 Reset Bitwarden form state');
    };

    const handleConnectBitwarden = async () => {
        if (!workspace) return;
        if (!bitwardenEmail.trim()) {
            toast.error('Email is required');
            return;
        }
        if (!bitwardenPassword.trim()) {
            toast.error('Master password is required');
            return;
        }

        try {
            setBitwardenConnecting(true);
            await connectVault(workspace.id, {
                provider: 'bitwarden',
                email: bitwardenEmail.trim(),
                masterPassword: bitwardenPassword.trim(),
                verificationCode: bitwardenCodeRequired ? bitwardenCode.trim() : undefined,
            });
            toast.success('Bitwarden vault connected!');
            setBitwardenDialogOpen(false);
            fetchIntegrations();
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Failed to connect vault';
            if (msg.includes('DEVICE_VERIFICATION_REQUIRED') || msg.includes('Device verification required')) {
                setBitwardenCodeRequired(true);
                toast.info('Verification code sent to your email. Enter it to continue.');
            } else {
                toast.error(msg);
            }
        } finally {
            setBitwardenConnecting(false);
        }
    };

    const handleDisconnectBitwarden = async () => {
        if (!workspace) return;
        try {
            await disconnectVault(workspace.id);
            toast.success('Bitwarden disconnected');
            fetchIntegrations();
        } catch {
            toast.error('Failed to disconnect Bitwarden');
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

    const getIntegrationLogo = (integration: Integration) => {
        return integration.connectionIcon
            || (integration.metadata as Record<string, unknown>)?.logo as string
            || logoMap[integration.composioToolkitSlug];
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
            ) : integrations.length === 0 && !vaultStatus?.connected ? (
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
                    {vaultStatus?.connected && (
                        <div
                            key="bitwarden"
                            className="rounded-lg border border-border/60 bg-card px-4 py-4 flex items-center justify-between"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                                    <Lock className="h-5 w-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold">Bitwarden</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {vaultStatus.email}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                            bitwarden
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] px-1.5 py-0 ${statusBadge(vaultStatus.status as Integration['status'])}`}
                                        >
                                            {vaultStatus.status}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <button className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Disconnect Bitwarden</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Are you sure you want to disconnect your Bitwarden vault? This will remove stored credentials and cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={handleDisconnectBitwarden}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                Disconnect
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    )}
                    {integrations.map((integration) => {
                        const logo = getIntegrationLogo(integration);
                        const displayLabel = integration.connectionLabel || integration.name;
                        return (
                            <div
                                key={integration.id}
                                className="rounded-lg border border-border/60 bg-card px-4 py-4 flex items-center justify-between"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted flex-shrink-0 overflow-hidden">
                                        {logo ? (
                                            <img
                                                src={logo}
                                                alt={displayLabel}
                                                className="h-10 w-10 rounded-lg object-contain"
                                            />
                                        ) : (
                                            <Plug className="h-5 w-5 text-violet-600" />
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold">{displayLabel}</p>
                                        {integration.connectionDescription && (
                                            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px]">
                                                {integration.connectionDescription}
                                            </p>
                                        )}
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
                                <div className="flex items-center gap-1">
                                    <button
                                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => handleOpenPermissions(integration)}
                                        title="Tool Permissions"
                                    >
                                        <Shield className="h-4 w-4" />
                                    </button>
                                    <button
                                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => handleEdit(integration)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </button>
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
                                                    Are you sure you want to delete &quot;{displayLabel}&quot;? This will disconnect the service and cannot be undone.
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
                            </div>
                        );
                    })}
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
                                {/* Bitwarden card */}
                                <button
                                    type="button"
                                    className="rounded-lg border border-border/60 bg-card p-3 flex items-start gap-3 text-left hover:bg-accent transition-colors cursor-pointer"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleSelectBitwarden();
                                    }}
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                                        <Lock className="h-4 w-4 text-blue-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium">Bitwarden</p>
                                            {vaultStatus?.connected && (
                                                <CheckCircle className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                            Connect your Bitwarden password vault so agents can securely fetch credentials during tasks.
                                        </p>
                                    </div>
                                </button>

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
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Connection Name <span className="text-red-500">*</span>
                            </label>
                            <Input
                                value={connectionLabel}
                                onChange={(e) => setConnectionLabel(e.target.value)}
                                placeholder={`e.g. "Work ${selectedToolkit?.name}", "Personal ${selectedToolkit?.name}"`}
                            />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Give this connection a memorable name. Your agent will use this name to identify the connection.
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Description <span className="text-muted-foreground font-normal">(optional)</span>
                            </label>
                            <Textarea
                                value={connectionDescription}
                                onChange={(e) => setConnectionDescription(e.target.value)}
                                placeholder="What is this connection for? e.g. &quot;Primary email for sending client reports&quot;"
                                rows={2}
                            />
                        </div>
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
                            disabled={connecting || connectionLabel.trim().length < 2}
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

            {/* Edit Connection Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Connection</DialogTitle>
                        <DialogDescription>
                            Update the name and description of this connection.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Connection Name <span className="text-red-500">*</span>
                            </label>
                            <Input
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                placeholder="Connection name"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Description <span className="text-muted-foreground font-normal">(optional)</span>
                            </label>
                            <Textarea
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                placeholder="What is this connection for?"
                                rows={2}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleSaveEdit} disabled={saving || editLabel.trim().length < 2}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bitwarden Connection Dialog */}
            <Dialog open={bitwardenDialogOpen} onOpenChange={setBitwardenDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Connect Bitwarden Vault</DialogTitle>
                        <DialogDescription>
                            Enter your Bitwarden email and master password to connect your vault.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Email <span className="text-red-500">*</span>
                            </label>
                            <Input
                                type="email"
                                value={bitwardenEmail}
                                onChange={(e) => setBitwardenEmail(e.target.value)}
                                placeholder="your@email.com"
                                disabled={bitwardenConnecting}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1.5 block">
                                Master Password <span className="text-red-500">*</span>
                            </label>
                            <Input
                                type="password"
                                value={bitwardenPassword}
                                onChange={(e) => setBitwardenPassword(e.target.value)}
                                placeholder="Your master password"
                                disabled={bitwardenConnecting}
                            />
                            <p className="text-xs text-muted-foreground mt-1.5">
                                Your master password is used once to derive a vault key and is never stored.
                            </p>
                        </div>
                        {bitwardenCodeRequired && (
                            <div>
                                <label className="text-sm font-medium mb-1.5 block">
                                    Verification Code <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    value={bitwardenCode}
                                    onChange={(e) => setBitwardenCode(e.target.value)}
                                    placeholder="Enter the code from your email"
                                    disabled={bitwardenConnecting}
                                />
                                <p className="text-xs text-muted-foreground mt-1.5">
                                    Check your email for a verification code from Bitwarden.
                                </p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setBitwardenDialogOpen(false);
                                setAddDialogOpen(true);
                            }}
                            disabled={bitwardenConnecting}
                        >
                            Back
                        </Button>
                        <Button
                            onClick={handleConnectBitwarden}
                            disabled={bitwardenConnecting || !bitwardenEmail.trim() || !bitwardenPassword.trim() || (bitwardenCodeRequired && !bitwardenCode.trim())}
                            className="gap-1.5"
                        >
                            {bitwardenConnecting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Connect Vault
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Tool Permissions Dialog */}
            <Dialog open={permDialogOpen} onOpenChange={setPermDialogOpen}>
                <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            Tool Permissions — {permIntegration?.connectionLabel || permIntegration?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Control which actions this integration can perform.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Mode toggle */}
                    <div className="flex gap-2">
                        <Button
                            variant={permMode === 'blocklist' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => { setPermMode('blocklist'); setSelectedTools(new Set()); }}
                        >
                            Block Selected
                        </Button>
                        <Button
                            variant={permMode === 'allowlist' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => { setPermMode('allowlist'); setSelectedTools(new Set()); }}
                        >
                            Allow Only Selected
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        {permMode === 'blocklist'
                            ? 'All actions are allowed except the ones you toggle on below.'
                            : 'Only the actions you toggle on below will be allowed.'}
                    </p>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search actions..."
                            value={actionSearch}
                            onChange={(e) => setActionSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    {/* Select all / Deselect all */}
                    {!loadingActions && actions.length > 0 && (
                        <div className="flex items-center justify-between">
                            <button
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                                onClick={handleSelectAllTools}
                            >
                                {actions
                                    .filter(a => !actionSearch || a.slug.toLowerCase().includes(actionSearch.toLowerCase()) || a.name.toLowerCase().includes(actionSearch.toLowerCase()))
                                    .every(a => selectedTools.has(a.slug))
                                    ? 'Deselect All'
                                    : 'Select All'}
                            </button>
                            <span className="text-xs text-muted-foreground">
                                {actions.filter(a => !actionSearch || a.slug.toLowerCase().includes(actionSearch.toLowerCase()) || a.name.toLowerCase().includes(actionSearch.toLowerCase())).length} actions
                            </span>
                        </div>
                    )}

                    {/* Actions list */}
                    <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
                        {loadingActions ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : actions.length === 0 ? (
                            <div className="flex items-center justify-center py-12">
                                <p className="text-sm text-muted-foreground">No actions found for this toolkit.</p>
                            </div>
                        ) : (
                            actions
                                .filter(a => !actionSearch || a.slug.toLowerCase().includes(actionSearch.toLowerCase()) || a.name.toLowerCase().includes(actionSearch.toLowerCase()))
                                .map((action) => (
                                    <div
                                        key={action.slug}
                                        className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                                    >
                                        <div className="flex-1 min-w-0 mr-3">
                                            <p className="text-xs font-mono font-medium truncate">{action.slug}</p>
                                            {action.description && (
                                                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{action.description}</p>
                                            )}
                                            {action.tags?.length > 0 && (
                                                <div className="flex gap-1 mt-1">
                                                    {action.tags.map((tag: string) => (
                                                        <Badge
                                                            key={tag}
                                                            variant="outline"
                                                            className={`text-[9px] px-1 py-0 ${tag === 'destructiveHint' ? 'border-red-300 text-red-600' : ''}`}
                                                        >
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <Switch
                                            checked={selectedTools.has(action.slug)}
                                            onCheckedChange={() => handleToggleTool(action.slug)}
                                        />
                                    </div>
                                ))
                        )}
                    </div>

                    <DialogFooter>
                        <div className="flex items-center justify-between w-full">
                            <p className="text-xs text-muted-foreground">
                                {selectedTools.size} action{selectedTools.size !== 1 ? 's' : ''} {permMode === 'blocklist' ? 'blocked' : 'allowed'}
                            </p>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setPermDialogOpen(false)} disabled={savingPerms}>
                                    Cancel
                                </Button>
                                <Button onClick={handleSavePermissions} disabled={savingPerms}>
                                    {savingPerms && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Save Permissions
                                </Button>
                            </div>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
