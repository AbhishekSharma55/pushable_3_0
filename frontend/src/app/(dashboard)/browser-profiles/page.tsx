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
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
} from '@/lib/api/browser';
import { getAgents } from '@/lib/api/agents';
import type { BrowserProfile, BrowserSession, Agent } from '@/types';

export default function BrowserProfilesPage() {
    const router = useRouter();
    const workspace = useActiveWorkspace();

    const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedProfile, setSelectedProfile] = useState<BrowserProfile | null>(null);

    // Create dialog
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [newAgent, setNewAgent] = useState<string>('');
    const [newOs, setNewOs] = useState<'windows' | 'macos' | 'linux'>('windows');
    const [creating, setCreating] = useState(false);

    // Browser session
    const [startingBrowser, setStartingBrowser] = useState(false);
    const [sessions, setSessions] = useState<BrowserSession[]>([]);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [profilesData, agentsData, sessionsData] = await Promise.all([
                getProfiles(workspace.id),
                getAgents(workspace.id),
                getSessions(workspace.id),
            ]);
            setProfiles(profilesData);
            setAgents(agentsData);
            setSessions(sessionsData);
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

    const refreshSessions = useCallback(async () => {
        if (!workspace) return;
        try {
            const data = await getSessions(workspace.id);
            setSessions(data);
        } catch { }
    }, [workspace]);

    const handleStartSession = async () => {
        if (!workspace || !selectedProfile) return;
        setStartingBrowser(true);
        try {
            const { sessionId } = await startSession(workspace.id, selectedProfile.id);
            router.push(`/browser-profiles/${sessionId}`);
        } catch {
            toast.error('Failed to start browser session');
            setStartingBrowser(false);
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
                            Manage browser profiles for your AI agents
                        </p>
                    </div>
                </div>
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
                <div className="flex flex-col items-center justify-center h-[calc(100vh-280px)] text-center gap-4">
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
                                onClick={() => {
                                    setSelectedProfile(profile);
                                }}
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

                    {/* Right: Detail + Preview */}
                    <div className="flex-1 min-w-0 space-y-4">
                        {selectedProfile ? (
                            <>
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

                                    {/* Assigned Agent */}
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

                                    {/* Session controls */}
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleStartSession} disabled={startingBrowser}>
                                            {startingBrowser ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Monitor className="h-3.5 w-3.5" />
                                            )}
                                            Start Session
                                        </Button>
                                    </div>
                                    {/* Sessions list */}
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

                            </>
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

            {/* Create Profile Dialog */}
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
        </div>
    );
}
