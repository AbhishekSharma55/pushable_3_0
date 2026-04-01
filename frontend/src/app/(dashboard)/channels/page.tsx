'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Radio,
    Plus,
    Trash2,
    Loader2,
    Send,
    Hash,
    Check,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
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
    getConnections,
    createConnection,
    testConnection,
    deleteConnection,
    updateConnection,
    getBotInfo,
    getConnectionConfig,
} from '@/lib/api/channels';
import type { BotInfo } from '@/lib/api/channels';
import { getAgents } from '@/lib/api/agents';
import type { ChannelConnection, Agent } from '@/types';
import { QRCodeSVG } from 'qrcode.react';

function ChannelIcon({ type, className = 'h-4 w-4' }: { type: string; className?: string }) {
    if (type === 'telegram') return <Send className={className} />;
    return <Hash className={className} />;
}

function StatusDot({ status }: { status: string }) {
    const color = status === 'active' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-gray-400';
    return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function ChannelsPage() {
    const workspace = useActiveWorkspace();
    const [connections, setConnections] = useState<ChannelConnection[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<ChannelConnection | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);

    // Create form state
    const [channelType, setChannelType] = useState<'telegram' | 'slack' | null>(null);
    const [formName, setFormName] = useState('');
    const [formAgentId, setFormAgentId] = useState('');
    const [formBotToken, setFormBotToken] = useState('');
    const [formSigningSecret, setFormSigningSecret] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; details: Record<string, unknown> } | null>(null);
    const [creating, setCreating] = useState(false);
    const [showTelegramGuide, setShowTelegramGuide] = useState(false);
    const [showSlackGuide, setShowSlackGuide] = useState(false);

    // Access control state
    const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
    const [knownUsers, setKnownUsers] = useState<Record<string, { username: string; firstName: string }>>({});
    const [newUserId, setNewUserId] = useState('');
    const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
    const [loadingConfig, setLoadingConfig] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const [showQr, setShowQr] = useState(false);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [conns, ags] = await Promise.all([
                getConnections(workspace.id),
                getAgents(workspace.id),
            ]);
            setConnections(conns);
            setAgents(ags);
        } catch {
            toast.error('Failed to load channels');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Load config + bot info when a Telegram connection is selected
    useEffect(() => {
        if (!workspace || !selected || selected.channelType !== 'telegram') {
            setAllowedUserIds([]);
            setKnownUsers({});
            setBotInfo(null);
            setShowQr(false);
            return;
        }
        let cancelled = false;
        const load = async () => {
            setLoadingConfig(true);
            try {
                const [config, info] = await Promise.all([
                    getConnectionConfig(workspace.id, selected.id),
                    getBotInfo(workspace.id, selected.id).catch(() => null),
                ]);
                if (cancelled) return;
                setAllowedUserIds((config.allowedUserIds as string[]) || []);
                setKnownUsers((config.knownUsers as Record<string, { username: string; firstName: string }>) || {});
                setBotInfo(info);
            } catch {
                if (!cancelled) toast.error('Failed to load access settings');
            } finally {
                if (!cancelled) setLoadingConfig(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [workspace, selected]);

    const saveAllowedUsers = async (userIds: string[]) => {
        if (!workspace || !selected) return;
        setSavingConfig(true);
        try {
            await updateConnection(workspace.id, selected.id, {
                config: { allowedUserIds: userIds },
            });
            setAllowedUserIds(userIds);
            toast.success('Access settings saved');
        } catch {
            toast.error('Failed to save access settings');
        } finally {
            setSavingConfig(false);
        }
    };

    const addUserId = () => {
        const id = newUserId.trim();
        if (!id) return;
        if (allowedUserIds.includes(id)) {
            toast.error('User ID already added');
            return;
        }
        const updated = [...allowedUserIds, id];
        setNewUserId('');
        saveAllowedUsers(updated);
    };

    const removeUserId = (id: string) => {
        saveAllowedUsers(allowedUserIds.filter((u) => u !== id));
    };

    const resetForm = () => {
        setChannelType(null);
        setFormName('');
        setFormAgentId('');
        setFormBotToken('');
        setFormSigningSecret('');
        setTestResult(null);
        setShowTelegramGuide(false);
        setShowSlackGuide(false);
    };

    const handleCreate = () => {
        resetForm();
        setSheetOpen(true);
    };

    const handleTest = async () => {
        if (!workspace || !selected) return;
        setTesting(true);
        try {
            const result = await testConnection(workspace.id, selected.id);
            setTestResult(result);
            toast.success(result.success ? 'Connection is valid' : 'Connection test failed');
        } catch {
            toast.error('Test failed');
        } finally {
            setTesting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteConnection(workspace.id, id);
            toast.success('Channel disconnected');
            if (selected?.id === id) setSelected(null);
            fetchData();
        } catch {
            toast.error('Failed to delete');
        }
    };

    const handleSubmit = async () => {
        if (!workspace || !channelType || !formName || !formAgentId || !formBotToken) return;
        setCreating(true);
        try {
            const credentials: Record<string, unknown> = { botToken: formBotToken };
            if (channelType === 'slack' && formSigningSecret) {
                credentials.signingSecret = formSigningSecret;
            }
            await createConnection(workspace.id, {
                agentId: formAgentId,
                channelType,
                name: formName,
                credentials,
            });
            toast.success('Channel connected');
            setSheetOpen(false);
            resetForm();
            fetchData();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Failed to create channel');
        } finally {
            setCreating(false);
        }
    };

    const agentNameMap = Object.fromEntries(agents.map((a) => [a.id, a.name]));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
                        <Radio className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
                        <p className="text-sm text-muted-foreground">
                            Connect agents to Telegram and Slack
                        </p>
                    </div>
                </div>
                <Button onClick={handleCreate} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Add Channel
                </Button>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-4 h-[calc(100vh-200px)]">
                {/* Left — Connection list */}
                <div className="w-[400px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-3 border-b border-border/60">
                        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Connections
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {loading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="p-3 space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-24" />
                                </div>
                            ))
                        ) : connections.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
                                <Radio className="h-8 w-8 text-muted-foreground/30" />
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">No channels connected</p>
                                    <p className="text-xs text-muted-foreground/70 mt-1">
                                        Add Telegram or Slack to let your agents talk to the world.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            connections.map((conn) => (
                                <div
                                    key={conn.id}
                                    className={`group flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer transition-colors ${
                                        selected?.id === conn.id ? 'bg-accent ring-1 ring-border' : 'hover:bg-accent/50'
                                    }`}
                                    onClick={() => { setSelected(conn); setTestResult(null); }}
                                >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                                        <ChannelIcon type={conn.channelType} className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium truncate">{conn.name}</p>
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                {conn.channelType}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <StatusDot status={conn.status} />
                                            <span className="text-[11px] text-muted-foreground">
                                                {agentNameMap[conn.agentId] || 'Agent'}
                                            </span>
                                        </div>
                                    </div>
                                    {conn.lastMessageAt && (
                                        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                                            {new Date(conn.lastMessageAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right — Detail panel */}
                <div className="flex-1 rounded-xl border border-border/60 bg-card overflow-y-auto">
                    {selected ? (
                        <div className="p-6 space-y-6">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
                                        <ChannelIcon type={selected.channelType} className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold">{selected.name}</h2>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <StatusDot status={selected.status} />
                                            <span className="text-sm text-muted-foreground capitalize">{selected.status}</span>
                                            <Badge variant="outline" className="text-xs">{selected.channelType}</Badge>
                                        </div>
                                    </div>
                                </div>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive gap-1.5">
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Disconnect
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Disconnect Channel</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will stop the bot and remove the connection. Messages will no longer be received.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(selected.id)} className="bg-destructive text-destructive-foreground">
                                                Disconnect
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>

                            {selected.errorMessage && (
                                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 flex items-start gap-2">
                                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                                    <p className="text-sm text-destructive">{selected.errorMessage}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Assigned Agent</p>
                                    <p className="text-sm font-medium">{agentNameMap[selected.agentId] || 'Unknown'}</p>
                                </div>
                                <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Last Message</p>
                                    <p className="text-sm font-medium">
                                        {selected.lastMessageAt
                                            ? new Date(selected.lastMessageAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                            : 'None yet'}
                                    </p>
                                </div>
                            </div>

                            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} className="gap-1.5">
                                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                Test Connection
                            </Button>

                            {testResult && (
                                <div className={`rounded-lg border px-4 py-3 text-sm ${testResult.success ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/5 border-destructive/20 text-destructive'}`}>
                                    {testResult.success ? 'Connection is valid' : 'Connection test failed'}
                                    {testResult.details && (
                                        <p className="text-xs mt-1 opacity-70">
                                            {Object.entries(testResult.details).map(([k, v]) => `${k}: ${v}`).join(', ')}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Access Control — Telegram only */}
                            {selected.channelType === 'telegram' && (
                                <div className="rounded-xl border border-border/60 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
                                        <h3 className="text-sm font-semibold">Access Control</h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Restrict which Telegram users can interact with this bot.
                                            {allowedUserIds.length === 0 && ' Currently no one can access the bot.'}
                                        </p>
                                    </div>

                                    <div className="p-4 space-y-4">
                                        {loadingConfig ? (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                Loading...
                                            </div>
                                        ) : (
                                            <>
                                                {/* Add user ID */}
                                                <div className="space-y-2">
                                                    <Label className="text-xs">Add Telegram User ID</Label>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            placeholder="e.g. 123456789"
                                                            value={newUserId}
                                                            onChange={(e) => setNewUserId(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && addUserId()}
                                                            className="flex-1"
                                                        />
                                                        <Button
                                                            size="sm"
                                                            onClick={addUserId}
                                                            disabled={savingConfig || !newUserId.trim()}
                                                            className="gap-1"
                                                        >
                                                            {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                                            Add
                                                        </Button>
                                                    </div>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        Users can find their ID by messaging <strong>@userinfobot</strong> on Telegram. Use <strong>*</strong> to allow everyone (not recommended).
                                                    </p>
                                                </div>

                                                {/* Allowed users list */}
                                                {allowedUserIds.length > 0 && (
                                                    <div className="space-y-1.5">
                                                        <Label className="text-xs">Allowed Users ({allowedUserIds.length})</Label>
                                                        <div className="space-y-1">
                                                            {allowedUserIds.map((uid) => {
                                                                const userInfo = knownUsers[uid];
                                                                const displayName = uid === '*' ? 'Everyone (wildcard)' : userInfo
                                                                    ? `${userInfo.firstName}${userInfo.username ? ` (@${userInfo.username})` : ''}`
                                                                    : null;
                                                                return (
                                                                    <div key={uid} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
                                                                        <div className="flex flex-col">
                                                                            {displayName && (
                                                                                <span className="text-xs font-medium">{displayName}</span>
                                                                            )}
                                                                            {uid !== '*' && (
                                                                                <span className="font-mono text-[11px] text-muted-foreground">{uid}</span>
                                                                            )}
                                                                        </div>
                                                                        <button
                                                                            onClick={() => removeUserId(uid)}
                                                                            className="text-muted-foreground hover:text-destructive transition-colors"
                                                                            disabled={savingConfig}
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {allowedUserIds.length === 0 && (
                                                    <div className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                                                        No users allowed — the bot will reject all messages. Add user IDs above, use the QR code for self-registration, or add <strong>*</strong> to allow everyone.
                                                    </div>
                                                )}

                                                {allowedUserIds.includes('*') && (
                                                    <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                                                        Wildcard <strong>*</strong> is set — anyone can message this bot. Remove it to restrict access.
                                                    </div>
                                                )}

                                                {/* QR Code self-registration */}
                                                {botInfo && (
                                                    <div className="border-t border-border/40 pt-4 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-xs font-semibold">QR Code Registration</p>
                                                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                                                    Share this QR code with users. When they scan it, they&apos;ll be auto-registered.
                                                                </p>
                                                            </div>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => setShowQr(!showQr)}
                                                                className="text-xs gap-1"
                                                            >
                                                                {showQr ? 'Hide' : 'Show'} QR
                                                            </Button>
                                                        </div>
                                                        {showQr && (
                                                            <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-4 border">
                                                                <QRCodeSVG
                                                                    value={botInfo.deepLink}
                                                                    size={200}
                                                                    level="M"
                                                                />
                                                                <div className="text-center">
                                                                    <p className="text-xs text-gray-600 font-medium">Scan to register with @{botInfo.username}</p>
                                                                    <a
                                                                        href={botInfo.deepLink}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-[11px] text-blue-600 hover:underline flex items-center justify-center gap-1 mt-1"
                                                                    >
                                                                        {botInfo.deepLink}
                                                                        <ExternalLink className="h-3 w-3" />
                                                                    </a>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-3">
                            <Radio className="h-8 w-8 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">Select a channel to see details</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Create Channel Sheet */}
            <Sheet open={sheetOpen} onOpenChange={(v) => { setSheetOpen(v); if (!v) resetForm(); }}>
                <SheetContent className="sm:max-w-lg overflow-y-auto px-6">
                    <SheetHeader>
                        <SheetTitle className="text-xl font-semibold">Add Channel</SheetTitle>
                        <SheetDescription>Connect a messaging platform to your agent.</SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6 mt-6 px-1">
                        {/* Step 1 — Choose type */}
                        {!channelType && (
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    className="flex flex-col items-center gap-3 rounded-xl border-2 border-border p-6 hover:border-primary hover:bg-primary/5 transition-all"
                                    onClick={() => setChannelType('telegram')}
                                >
                                    <Send className="h-8 w-8 text-blue-500" />
                                    <div className="text-center">
                                        <p className="text-sm font-semibold">Telegram</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Connect a Telegram bot</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    className="flex flex-col items-center gap-3 rounded-xl border-2 border-border p-6 hover:border-primary hover:bg-primary/5 transition-all"
                                    onClick={() => setChannelType('slack')}
                                >
                                    <Hash className="h-8 w-8 text-purple-500" />
                                    <div className="text-center">
                                        <p className="text-sm font-semibold">Slack</p>
                                        <p className="text-[11px] text-muted-foreground mt-1">Connect to your Slack workspace</p>
                                    </div>
                                </button>
                            </div>
                        )}

                        {/* Step 2 — Configure */}
                        {channelType && (
                            <>
                                <div className="flex items-center gap-2 mb-2">
                                    <button onClick={resetForm} className="text-xs text-muted-foreground hover:text-foreground">&larr; Back</button>
                                    <Badge variant="outline">{channelType}</Badge>
                                </div>

                                <div className="space-y-2">
                                    <Label>Connection Name</Label>
                                    <Input placeholder="e.g. Support Bot" value={formName} onChange={(e) => setFormName(e.target.value)} />
                                </div>

                                <div className="space-y-2">
                                    <Label>Assign to Agent</Label>
                                    <Select value={formAgentId} onValueChange={setFormAgentId}>
                                        <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                                        <SelectContent>
                                            {agents.map((a) => (
                                                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Bot Token</Label>
                                    <Input
                                        type="password"
                                        placeholder={channelType === 'telegram' ? 'e.g. 123456:ABC-DEF...' : 'xoxb-...'}
                                        value={formBotToken}
                                        onChange={(e) => setFormBotToken(e.target.value)}
                                    />
                                </div>

                                {channelType === 'slack' && (
                                    <div className="space-y-2">
                                        <Label>Signing Secret</Label>
                                        <Input type="password" placeholder="Signing secret from Basic Information" value={formSigningSecret} onChange={(e) => setFormSigningSecret(e.target.value)} />
                                    </div>
                                )}

                                {/* Setup guide */}
                                {channelType === 'telegram' && (
                                    <div className="rounded-lg border border-border/60">
                                        <button
                                            type="button"
                                            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowTelegramGuide(!showTelegramGuide)}
                                        >
                                            How to get your bot token
                                            {showTelegramGuide ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                        </button>
                                        {showTelegramGuide && (
                                            <div className="px-4 pb-3 text-xs text-muted-foreground space-y-1.5 border-t border-border/40 pt-2.5">
                                                <p>1. Open Telegram and search for <strong>@BotFather</strong></p>
                                                <p>2. Send <code>/newbot</code> and follow the prompts</p>
                                                <p>3. Copy the token BotFather gives you</p>
                                                <p>4. Paste it in the field above</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {channelType === 'slack' && (
                                    <div className="rounded-lg border border-border/60">
                                        <button
                                            type="button"
                                            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowSlackGuide(!showSlackGuide)}
                                        >
                                            How to set up Slack app
                                            {showSlackGuide ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                        </button>
                                        {showSlackGuide && (
                                            <div className="px-4 pb-3 text-xs text-muted-foreground space-y-1.5 border-t border-border/40 pt-2.5">
                                                <p>1. Go to <strong>api.slack.com/apps</strong> &rarr; Create New App</p>
                                                <p>2. From Scratch &rarr; name your app &rarr; pick workspace</p>
                                                <p>3. OAuth &amp; Permissions &rarr; add scopes: <code>channels:history</code>, <code>chat:write</code>, <code>app_mentions:read</code>, <code>im:history</code>, <code>users:read</code></p>
                                                <p>4. Install to workspace &rarr; copy Bot User OAuth Token</p>
                                                <p>5. Basic Information &rarr; copy Signing Secret</p>
                                                <p>6. Event Subscriptions &rarr; enable &rarr; subscribe to: <code>app_mention</code>, <code>message.im</code></p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <Button
                                    className="w-full"
                                    disabled={creating || !formName || !formAgentId || !formBotToken}
                                    onClick={handleSubmit}
                                >
                                    {creating ? (
                                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</>
                                    ) : (
                                        'Connect Channel'
                                    )}
                                </Button>
                            </>
                        )}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
