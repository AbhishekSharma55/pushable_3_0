'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Globe,
    Plus,
    Trash2,
    Loader2,
    Sparkles,
    Monitor,
    Bot,
    ExternalLink,
    Zap,
    Shield,
    CheckCircle2,
    XCircle,
    Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    startSession,
    getSessions,
    getProxies,
    createProxy,
    testProxy,
    deleteProxy,
} from '@/lib/api/browser';
import { getAgents } from '@/lib/api/agents';
import type { BrowserProfile, BrowserSession, Agent, BrowserProxy } from '@/types';

function countryToFlag(code: string): string {
    const codePoints = code
        .toUpperCase()
        .split('')
        .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
    return String.fromCodePoint(...codePoints);
}

export default function BrowserProfilesPage() {
    const router = useRouter();
    const workspace = useActiveWorkspace();

    const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedProfile, setSelectedProfile] = useState<BrowserProfile | null>(null);

    // Create profile dialog
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newAgent, setNewAgent] = useState<string>('');
    const [newOs, setNewOs] = useState<'windows' | 'macos' | 'linux'>('windows');
    const [creating, setCreating] = useState(false);

    // Browser session
    const [startingBrowser, setStartingBrowser] = useState(false);
    const [sessions, setSessions] = useState<BrowserSession[]>([]);

    // Start session dialog
    const [startSessionOpen, setStartSessionOpen] = useState(false);
    const [selectedProxyId, setSelectedProxyId] = useState<string>('__none__');

    // Proxies
    const [proxies, setProxies] = useState<BrowserProxy[]>([]);
    const [selectedProxy, setSelectedProxy] = useState<BrowserProxy | null>(null);
    const [testingProxyId, setTestingProxyId] = useState<string | null>(null);

    // Create proxy dialog
    const [createProxyOpen, setCreateProxyOpen] = useState(false);
    const [proxyInputMode, setProxyInputMode] = useState<'paste' | 'manual'>('paste');
    const [proxyConnectionString, setProxyConnectionString] = useState('');
    const [proxyLabel, setProxyLabel] = useState('');
    const [proxyHost, setProxyHost] = useState('');
    const [proxyPort, setProxyPort] = useState('');
    const [proxyUsername, setProxyUsername] = useState('');
    const [proxyPassword, setProxyPassword] = useState('');
    const [proxyProtocol, setProxyProtocol] = useState<'http' | 'https' | 'socks5'>('http');
    const [proxyCountry, setProxyCountry] = useState('');
    const [proxyCity, setProxyCity] = useState('');
    const [creatingProxy, setCreatingProxy] = useState(false);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [profilesData, agentsData, sessionsData, proxiesData] = await Promise.all([
                getProfiles(workspace.id),
                getAgents(workspace.id),
                getSessions(workspace.id),
                getProxies(workspace.id),
            ]);
            setProfiles(profilesData);
            setAgents(agentsData);
            setSessions(sessionsData);
            setProxies(proxiesData);
        } catch {
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleCreate = async () => {
        if (!workspace || !newName.trim()) return;
        setCreating(true);
        try {
            const profile = await createProfile(workspace.id, {
                name: newName.trim(),
                assignedAgentId: newAgent || null,
                os: newOs,
            });
            setProfiles((prev) => [...prev, profile]);
            setSelectedProfile(profile);
            setCreateOpen(false);
            setNewName('');
            setNewAgent('');
            setNewOs('windows');
            toast.success('Profile created');
        } catch {
            toast.error('Failed to create profile');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteProfile(workspace.id, id);
            setProfiles((prev) => prev.filter((p) => p.id !== id));
            if (selectedProfile?.id === id) setSelectedProfile(null);
            toast.success('Profile deleted');
        } catch {
            toast.error('Failed to delete profile');
        }
    };

    const handleAssignAgent = async (agentId: string) => {
        if (!workspace || !selectedProfile) return;
        try {
            const updated = await updateProfile(workspace.id, selectedProfile.id, {
                assignedAgentId: agentId === '__none__' ? null : agentId,
            });
            setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setSelectedProfile(updated);
            toast.success('Agent assignment updated');
        } catch {
            toast.error('Failed to update profile');
        }
    };

    const handleStartSession = async () => {
        if (!workspace || !selectedProfile) return;
        setStartingBrowser(true);
        try {
            const proxyId = selectedProxyId === '__none__' ? undefined : selectedProxyId;
            const { sessionId } = await startSession(workspace.id, selectedProfile.id, undefined, proxyId);
            setStartSessionOpen(false);
            router.push(`/browser-profiles/${sessionId}`);
        } catch {
            toast.error('Failed to start browser session');
            setStartingBrowser(false);
        }
    };

    const openStartSession = () => {
        setSelectedProxyId('__none__');
        setStartSessionOpen(true);
    };

    // ── Proxy handlers ──

    const handleCreateProxy = async () => {
        if (!workspace || !proxyLabel.trim()) return;
        setCreatingProxy(true);
        try {
            const data = proxyInputMode === 'paste'
                ? {
                    label: proxyLabel.trim(),
                    connectionString: proxyConnectionString.trim(),
                    country: proxyCountry.trim() || undefined,
                    city: proxyCity.trim() || undefined,
                }
                : {
                    label: proxyLabel.trim(),
                    host: proxyHost.trim(),
                    port: parseInt(proxyPort, 10),
                    username: proxyUsername.trim(),
                    password: proxyPassword.trim(),
                    protocol: proxyProtocol,
                    country: proxyCountry.trim() || undefined,
                    city: proxyCity.trim() || undefined,
                };

            const proxy = await createProxy(workspace.id, data);
            setProxies((prev) => [...prev, proxy]);
            setCreateProxyOpen(false);
            resetProxyForm();
            toast.success('Proxy added');
        } catch {
            toast.error('Failed to create proxy. Check the format.');
        } finally {
            setCreatingProxy(false);
        }
    };

    const resetProxyForm = () => {
        setProxyLabel('');
        setProxyConnectionString('');
        setProxyHost('');
        setProxyPort('');
        setProxyUsername('');
        setProxyPassword('');
        setProxyProtocol('http');
        setProxyCountry('');
        setProxyCity('');
        setProxyInputMode('paste');
    };

    const handleTestProxy = async (id: string) => {
        if (!workspace) return;
        setTestingProxyId(id);
        try {
            const result = await testProxy(workspace.id, id);
            if (result.success) {
                toast.success(`Proxy working! IP: ${result.ip}`);
            } else {
                toast.error(`Proxy test failed: ${result.error}`);
            }
            // Refresh proxies to get updated test status
            const updated = await getProxies(workspace.id);
            setProxies(updated);
        } catch {
            toast.error('Failed to test proxy');
        } finally {
            setTestingProxyId(null);
        }
    };

    const handleDeleteProxy = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteProxy(workspace.id, id);
            setProxies((prev) => prev.filter((p) => p.id !== id));
            if (selectedProxy?.id === id) setSelectedProxy(null);
            toast.success('Proxy deleted');
        } catch {
            toast.error('Failed to delete proxy');
        }
    };

    const getAgentName = (agentId: string | null) => {
        if (!agentId) return 'Unassigned';
        const agent = agents.find((a) => a.id === agentId);
        return agent?.name || 'Unknown';
    };

    const osBadge = (os: string) => {
        switch (os) {
            case 'windows':
                return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
            case 'macos':
                return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
            case 'linux':
                return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
            default:
                return 'bg-muted text-muted-foreground';
        }
    };

    const testStatusBadge = (status: BrowserProxy['lastTestStatus'], testedAt: string | null) => {
        const timeStr = testedAt
            ? new Date(testedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';

        switch (status) {
            case 'success':
                return (
                    <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        <span className="text-[10px] text-emerald-600">Working</span>
                        {timeStr && <span className="text-[10px] text-muted-foreground">{timeStr}</span>}
                    </div>
                );
            case 'failed':
                return (
                    <div className="flex items-center gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        <span className="text-[10px] text-red-600">Failed</span>
                        {timeStr && <span className="text-[10px] text-muted-foreground">{timeStr}</span>}
                    </div>
                );
            default:
                return (
                    <div className="flex items-center gap-1">
                        <Circle className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">Untested</span>
                    </div>
                );
        }
    };

    const activeProxies = proxies.filter((p) => p.isActive);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/20">
                        <Globe className="h-5 w-5 text-sky-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Browser Profiles</h1>
                        <p className="text-sm text-muted-foreground">
                            Manage browser profiles and proxies for your AI agents
                        </p>
                    </div>
                </div>
            </div>

            <Tabs defaultValue="profiles" className="w-full">
                <TabsList>
                    <TabsTrigger value="profiles">Profiles</TabsTrigger>
                    <TabsTrigger value="proxies">Proxies</TabsTrigger>
                </TabsList>

                {/* ═══════════ PROFILES TAB ═══════════ */}
                <TabsContent value="profiles" className="mt-4">
                    <div className="flex items-center justify-end mb-4">
                        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                            <Plus className="h-4 w-4" />
                            New Profile
                        </Button>
                    </div>

                    {loading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="rounded-lg border border-border/60 bg-card px-4 py-4 flex items-center gap-3">
                                    <Skeleton className="h-10 w-10 rounded-lg" />
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : profiles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[calc(100vh-340px)] text-center gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-sky-500/10 to-blue-500/10 flex items-center justify-center">
                                <Sparkles className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">No browser profiles</p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Create a profile to give your AI agents browser capabilities.
                                </p>
                            </div>
                            <Button variant="outline" onClick={() => setCreateOpen(true)} className="gap-1.5 mt-2">
                                <Plus className="h-4 w-4" />
                                New Profile
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-6">
                            {/* Left: Profile list */}
                            <div className="w-[380px] flex-shrink-0 space-y-2">
                                {profiles.map((profile) => (
                                    <button
                                        key={profile.id}
                                        className={`w-full rounded-lg border bg-card px-4 py-3 flex items-center justify-between text-left transition-colors ${
                                            selectedProfile?.id === profile.id
                                                ? 'border-primary/50 bg-accent'
                                                : 'border-border/60 hover:bg-accent/50'
                                        }`}
                                        onClick={() => setSelectedProfile(profile)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/15 to-blue-500/15 flex-shrink-0">
                                                <Globe className="h-4 w-4 text-sky-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium">{profile.name}</p>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${osBadge(profile.os)}`}>
                                                        {profile.os}
                                                    </Badge>
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {getAgentName(profile.assignedAgentId)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <button
                                                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete Profile</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Are you sure you want to delete &quot;{profile.name}&quot;? This cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDelete(profile.id)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </button>
                                ))}
                            </div>

                            {/* Right: Detail */}
                            <div className="flex-1 min-w-0 space-y-4">
                                {selectedProfile ? (
                                    <div className="rounded-lg border border-border/60 bg-card p-5 space-y-4">
                                        <div>
                                            <h2 className="text-lg font-semibold">{selectedProfile.name}</h2>
                                            <div className="flex items-center gap-2 mt-1">
                                                <Badge variant="outline" className={`text-xs ${osBadge(selectedProfile.os)}`}>
                                                    {selectedProfile.os}
                                                </Badge>
                                                <Badge variant="outline" className={`text-xs ${selectedProfile.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground'}`}>
                                                    {selectedProfile.status}
                                                </Badge>
                                            </div>
                                        </div>

                                        <div>
                                            <Label className="text-sm font-medium mb-2 block">Assigned Agent</Label>
                                            <Select
                                                value={selectedProfile.assignedAgentId || '__none__'}
                                                onValueChange={handleAssignAgent}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">Unassigned</SelectItem>
                                                    {agents.map((agent) => (
                                                        <SelectItem key={agent.id} value={agent.id}>
                                                            <div className="flex items-center gap-2">
                                                                <Bot className="h-3.5 w-3.5" />
                                                                {agent.name}
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" className="gap-1.5" onClick={openStartSession} disabled={startingBrowser}>
                                                {startingBrowser ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Monitor className="h-3.5 w-3.5" />
                                                )}
                                                Start Session
                                            </Button>
                                        </div>

                                        {(() => {
                                            const profileSessions = sessions.filter(
                                                (s) => s.profileId === selectedProfile.id
                                            );
                                            if (profileSessions.length === 0) return null;
                                            return (
                                                <div>
                                                    <Label className="text-sm font-medium mb-2 block">Sessions</Label>
                                                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                                                        {profileSessions.map((s) => (
                                                            <button
                                                                key={s.id}
                                                                onClick={() => {
                                                                    if (s.status === 'active') {
                                                                        router.push(`/browser-profiles/${s.id}`);
                                                                    }
                                                                }}
                                                                className={`w-full flex items-center justify-between rounded-md border px-3 py-2 text-xs transition-colors ${
                                                                    s.status === 'active'
                                                                        ? 'border-border/60 bg-muted/30 hover:bg-accent/50 cursor-pointer'
                                                                        : 'border-border/60 bg-muted/30 cursor-default opacity-60'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`h-2 w-2 rounded-full ${
                                                                        s.status === 'active' ? 'bg-emerald-500' :
                                                                        s.status === 'starting' ? 'bg-amber-500 animate-pulse' :
                                                                        s.status === 'error' ? 'bg-red-500' :
                                                                        'bg-muted-foreground/40'
                                                                    }`} />
                                                                    <span className="font-mono text-muted-foreground">{s.id.slice(0, 8)}</span>
                                                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                                                                        s.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                                                                        s.status === 'error' ? 'bg-red-500/10 text-red-600 border-red-500/20' :
                                                                        s.status === 'closed' ? 'bg-muted text-muted-foreground' :
                                                                        'bg-amber-500/10 text-amber-600 border-amber-500/20'
                                                                    }`}>
                                                                        {s.status}
                                                                    </Badge>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-muted-foreground">
                                                                        {new Date(s.createdAt).toLocaleString('en-US', {
                                                                            month: 'short', day: 'numeric',
                                                                            hour: '2-digit', minute: '2-digit',
                                                                        })}
                                                                    </span>
                                                                    {s.status === 'active' && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                router.push(`/browser-profiles/${s.id}`);
                                                                            }}
                                                                            className="p-1 rounded hover:bg-accent transition-colors"
                                                                            title="Open full page preview"
                                                                        >
                                                                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
                                        <Globe className="h-10 w-10 text-muted-foreground/30" />
                                        <p className="text-sm text-muted-foreground">
                                            Select a profile to view details
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </TabsContent>

                {/* ═══════════ PROXIES TAB ═══════════ */}
                <TabsContent value="proxies" className="mt-4">
                    <div className="flex items-center justify-end mb-4">
                        <Button onClick={() => setCreateProxyOpen(true)} className="gap-1.5">
                            <Plus className="h-4 w-4" />
                            Add Proxy
                        </Button>
                    </div>

                    {loading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="rounded-lg border border-border/60 bg-card px-4 py-4 flex items-center gap-3">
                                    <Skeleton className="h-10 w-10 rounded-lg" />
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : proxies.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[calc(100vh-340px)] text-center gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 flex items-center justify-center">
                                <Shield className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">No proxies configured</p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Add proxies to route browser sessions through different locations.
                                </p>
                            </div>
                            <Button variant="outline" onClick={() => setCreateProxyOpen(true)} className="gap-1.5 mt-2">
                                <Plus className="h-4 w-4" />
                                Add Proxy
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-6">
                            {/* Left: Proxy list */}
                            <div className="w-[380px] flex-shrink-0 space-y-2">
                                {proxies.map((proxy) => (
                                    <button
                                        key={proxy.id}
                                        className={`w-full rounded-lg border bg-card px-4 py-3 text-left transition-colors ${
                                            selectedProxy?.id === proxy.id
                                                ? 'border-primary/50 bg-accent'
                                                : 'border-border/60 hover:bg-accent/50'
                                        }`}
                                        onClick={() => setSelectedProxy(proxy)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-purple-500/15 flex-shrink-0">
                                                    <Shield className="h-4 w-4 text-violet-600" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-sm font-medium truncate">{proxy.label}</p>
                                                        {proxy.country && (
                                                            <span className="text-sm">{countryToFlag(proxy.country)}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-[11px] text-muted-foreground font-mono">
                                                            {proxy.host}:{proxy.port}
                                                        </span>
                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                            {proxy.protocol.toUpperCase()}
                                                        </Badge>
                                                    </div>
                                                    <div className="mt-0.5">
                                                        {testStatusBadge(proxy.lastTestStatus, proxy.lastTestedAt)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                <button
                                                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-violet-600 transition-colors"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleTestProxy(proxy.id);
                                                    }}
                                                    disabled={testingProxyId === proxy.id}
                                                    title="Test proxy"
                                                >
                                                    {testingProxyId === proxy.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Zap className="h-4 w-4" />
                                                    )}
                                                </button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <button
                                                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Delete Proxy</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Are you sure you want to delete &quot;{proxy.label}&quot;?
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={() => handleDeleteProxy(proxy.id)}
                                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                            >
                                                                Delete
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            {/* Right: Proxy detail */}
                            <div className="flex-1 min-w-0">
                                {selectedProxy ? (
                                    <div className="rounded-lg border border-border/60 bg-card p-5 space-y-4">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-lg font-semibold">{selectedProxy.label}</h2>
                                                {selectedProxy.country && (
                                                    <span className="text-lg">{countryToFlag(selectedProxy.country)}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <Badge variant="outline" className="text-xs font-mono">
                                                    {selectedProxy.host}:{selectedProxy.port}
                                                </Badge>
                                                <Badge variant="outline" className="text-xs">
                                                    {selectedProxy.protocol.toUpperCase()}
                                                </Badge>
                                                {selectedProxy.country && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {selectedProxy.country}
                                                        {selectedProxy.city && ` - ${selectedProxy.city}`}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <Label className="text-sm font-medium mb-2 block">Test Status</Label>
                                            {testStatusBadge(selectedProxy.lastTestStatus, selectedProxy.lastTestedAt)}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-1.5"
                                                onClick={() => handleTestProxy(selectedProxy.id)}
                                                disabled={testingProxyId === selectedProxy.id}
                                            >
                                                {testingProxyId === selectedProxy.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Zap className="h-3.5 w-3.5" />
                                                )}
                                                Test Connection
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
                                        <Shield className="h-10 w-10 text-muted-foreground/30" />
                                        <p className="text-sm text-muted-foreground">
                                            Select a proxy to view details
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* ═══════════ CREATE PROFILE DIALOG ═══════════ */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Browser Profile</DialogTitle>
                        <DialogDescription>
                            Create a new browser profile for your AI agents.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                placeholder="e.g. Research Browser"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Assign to Agent (optional)</Label>
                            <Select value={newAgent} onValueChange={setNewAgent}>
                                <SelectTrigger>
                                    <SelectValue placeholder="No agent" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No agent</SelectItem>
                                    {agents.map((agent) => (
                                        <SelectItem key={agent.id} value={agent.id}>
                                            {agent.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>OS Fingerprint</Label>
                            <Select value={newOs} onValueChange={(v) => setNewOs(v as 'windows' | 'macos' | 'linux')}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="windows">Windows</SelectItem>
                                    <SelectItem value="macos">macOS</SelectItem>
                                    <SelectItem value="linux">Linux</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                            {creating ? 'Creating...' : 'Create Profile'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ═══════════ START SESSION DIALOG ═══════════ */}
            <Dialog open={startSessionOpen} onOpenChange={setStartSessionOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Start Browser Session</DialogTitle>
                        <DialogDescription>
                            Configure and start a new browser session.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Profile</Label>
                            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                                <Globe className="h-4 w-4 text-muted-foreground" />
                                {selectedProfile?.name ?? 'No profile selected'}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Proxy (optional)</Label>
                            <Select value={selectedProxyId} onValueChange={setSelectedProxyId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="No Proxy (Direct)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">No Proxy (Direct)</SelectItem>
                                    {activeProxies.map((proxy) => (
                                        <SelectItem key={proxy.id} value={proxy.id}>
                                            <div className="flex items-center gap-2">
                                                {proxy.country && (
                                                    <span className="text-sm">{countryToFlag(proxy.country)}</span>
                                                )}
                                                <span>{proxy.label}</span>
                                                <span className="text-muted-foreground font-mono text-xs">
                                                    {proxy.host}:{proxy.port}
                                                </span>
                                                {proxy.lastTestStatus === 'success' && (
                                                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                                )}
                                                {proxy.lastTestStatus === 'failed' && (
                                                    <XCircle className="h-3 w-3 text-red-500" />
                                                )}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStartSessionOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleStartSession} disabled={startingBrowser} className="gap-1.5">
                            {startingBrowser ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Monitor className="h-3.5 w-3.5" />
                            )}
                            Start Session
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ═══════════ CREATE PROXY DIALOG ═══════════ */}
            <Dialog open={createProxyOpen} onOpenChange={(open) => { setCreateProxyOpen(open); if (!open) resetProxyForm(); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Add Proxy</DialogTitle>
                        <DialogDescription>
                            Add a new proxy for browser sessions.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Label *</Label>
                            <Input
                                placeholder="e.g. India - Mumbai"
                                value={proxyLabel}
                                onChange={(e) => setProxyLabel(e.target.value)}
                            />
                        </div>

                        <Tabs value={proxyInputMode} onValueChange={(v) => setProxyInputMode(v as 'paste' | 'manual')}>
                            <TabsList className="w-full">
                                <TabsTrigger value="paste" className="flex-1">Paste Connection String</TabsTrigger>
                                <TabsTrigger value="manual" className="flex-1">Fill Manually</TabsTrigger>
                            </TabsList>

                            <TabsContent value="paste" className="mt-3 space-y-2">
                                <Textarea
                                    placeholder="633273d8fc72a767:SC7ov4DO@res.geonix.com:10000"
                                    value={proxyConnectionString}
                                    onChange={(e) => setProxyConnectionString(e.target.value)}
                                    rows={2}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Supports: user:pass@host:port or protocol://user:pass@host:port
                                </p>
                            </TabsContent>

                            <TabsContent value="manual" className="mt-3 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Host *</Label>
                                        <Input
                                            placeholder="res.geonix.com"
                                            value={proxyHost}
                                            onChange={(e) => setProxyHost(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Port *</Label>
                                        <Input
                                            type="number"
                                            placeholder="10000"
                                            value={proxyPort}
                                            onChange={(e) => setProxyPort(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Username *</Label>
                                        <Input
                                            placeholder="username"
                                            value={proxyUsername}
                                            onChange={(e) => setProxyUsername(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Password *</Label>
                                        <Input
                                            type="password"
                                            placeholder="password"
                                            value={proxyPassword}
                                            onChange={(e) => setProxyPassword(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Protocol</Label>
                                    <Select value={proxyProtocol} onValueChange={(v) => setProxyProtocol(v as 'http' | 'https' | 'socks5')}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="http">HTTP</SelectItem>
                                            <SelectItem value="https">HTTPS</SelectItem>
                                            <SelectItem value="socks5">SOCKS5</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </TabsContent>
                        </Tabs>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Country Code</Label>
                                <Input
                                    placeholder="IN"
                                    maxLength={2}
                                    value={proxyCountry}
                                    onChange={(e) => setProxyCountry(e.target.value.toUpperCase())}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">City</Label>
                                <Input
                                    placeholder="Mumbai"
                                    value={proxyCity}
                                    onChange={(e) => setProxyCity(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setCreateProxyOpen(false); resetProxyForm(); }}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreateProxy}
                            disabled={creatingProxy || !proxyLabel.trim() || (proxyInputMode === 'paste' ? !proxyConnectionString.trim() : !proxyHost.trim() || !proxyPort || !proxyUsername.trim() || !proxyPassword.trim())}
                        >
                            {creatingProxy ? 'Saving...' : 'Save Proxy'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
