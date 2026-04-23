'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Users,
    Mail,
    Crown,
    Shield,
    User,
    Loader2,
    Plus,
    X,
    RotateCcw,
    Trash2,
    Settings,
    UserPlus,
    Copy,
    Check,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getMembers,
    getInvitations,
    inviteUser,
    revokeInvitation,
    setUserCreditLimit,
    removeUserCreditLimit,
    resetUserCredits,
    getUserAgentAccess,
    setUserAgentAccess,
    removeMember,
} from '@/lib/api/members';
import { apiClient } from '@/lib/api/client';
import { getMyMemberInfo } from '@/lib/api/members';
import type { MemberWithCredits, WorkspaceInvitation, UserAgentAccess, Agent } from '@/types';

const ROLE_ICONS: Record<string, typeof Crown> = {
    owner: Crown,
    admin: Shield,
    member: User,
};

const ROLE_COLORS: Record<string, string> = {
    owner: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    admin: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    member: 'bg-muted/50 text-muted-foreground border-border/60',
};

export default function MembersPage() {
    const workspace = useActiveWorkspace();
    const router = useRouter();
    const [members, setMembers] = useState<MemberWithCredits[]>([]);
    const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);

    // Check if user is workspace owner
    useEffect(() => {
        if (!workspace) return;
        getMyMemberInfo(workspace.id)
            .then((info) => {
                if (info.role !== 'owner') {
                    router.push('/');
                } else {
                    setAuthorized(true);
                }
            })
            .catch(() => router.push('/'));
    }, [workspace, router]);

    // Invite dialog
    const [showInvite, setShowInvite] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviting, setInviting] = useState(false);
    const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Manage member dialog
    const [manageMember, setManageMember] = useState<MemberWithCredits | null>(null);
    const [memberAgentAccess, setMemberAgentAccess] = useState<UserAgentAccess[]>([]);
    const [creditLimitInput, setCreditLimitInput] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [membersData, invitationsData, agentsData] = await Promise.all([
                getMembers(workspace.id),
                getInvitations(workspace.id).catch(() => [] as WorkspaceInvitation[]),
                apiClient
                    .get('/api/agents', { headers: { 'x-workspace-id': workspace.id } })
                    .then((r) => r.data.data as Agent[])
                    .catch(() => [] as Agent[]),
            ]);
            setMembers(membersData);
            setInvitations(invitationsData.filter((i) => i.status === 'pending'));
            setAgents(agentsData);
        } catch {
            toast.error('Failed to load members');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleInvite = async () => {
        if (!workspace || !inviteEmail.trim()) return;
        setInviting(true);
        try {
            const result = await inviteUser(workspace.id, inviteEmail.trim(), 'member');
            const frontendUrl = window.location.origin;
            const link = `${frontendUrl}/invite/${result.token}`;
            setLastInviteLink(link);
            toast.success(`Invitation created for ${inviteEmail}`);
            setInviteEmail('');
            fetchData();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to send invitation');
        } finally {
            setInviting(false);
        }
    };

    const handleCopyLink = () => {
        if (!lastInviteLink) return;
        navigator.clipboard.writeText(lastInviteLink);
        setCopied(true);
        toast.success('Invite link copied!');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCloseInvite = () => {
        setShowInvite(false);
        setLastInviteLink(null);
        setInviteEmail('');
        setCopied(false);
    };

    const handleRevokeInvitation = async (invitationId: string) => {
        if (!workspace) return;
        try {
            await revokeInvitation(workspace.id, invitationId);
            toast.success('Invitation revoked');
            fetchData();
        } catch {
            toast.error('Failed to revoke invitation');
        }
    };

    const openManageMember = async (member: MemberWithCredits) => {
        if (!workspace) return;
        setManageMember(member);
        setCreditLimitInput(member.creditLimit?.toString() || '');
        try {
            const access = await getUserAgentAccess(workspace.id, member.userId);
            setMemberAgentAccess(access);
        } catch {
            setMemberAgentAccess([]);
        }
    };

    const handleSaveCreditLimit = async () => {
        if (!workspace || !manageMember) return;
        setSaving(true);
        try {
            const limit = parseInt(creditLimitInput, 10);
            if (isNaN(limit) || limit < 0) {
                toast.error('Please enter a valid credit limit');
                setSaving(false);
                return;
            }
            await setUserCreditLimit(workspace.id, manageMember.userId, limit);
            toast.success('Credit limit updated');
            fetchData();
            setManageMember((prev) => (prev ? { ...prev, creditLimit: limit } : prev));
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update credit limit');
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveCreditLimit = async () => {
        if (!workspace || !manageMember) return;
        setSaving(true);
        try {
            await removeUserCreditLimit(workspace.id, manageMember.userId);
            toast.success('Credit limit removed');
            fetchData();
            setManageMember((prev) => (prev ? { ...prev, creditLimit: null, creditsUsed: null } : prev));
            setCreditLimitInput('');
        } catch {
            toast.error('Failed to remove credit limit');
        } finally {
            setSaving(false);
        }
    };

    const handleResetCredits = async () => {
        if (!workspace || !manageMember) return;
        setSaving(true);
        try {
            await resetUserCredits(workspace.id, manageMember.userId);
            toast.success('Credits usage reset to 0');
            fetchData();
            setManageMember((prev) => (prev ? { ...prev, creditsUsed: 0 } : prev));
        } catch {
            toast.error('Failed to reset credits');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleAgentAccess = async (agentId: string, allowed: boolean) => {
        if (!workspace || !manageMember) return;
        try {
            await setUserAgentAccess(workspace.id, manageMember.userId, [{ agentId, allowed }]);
            setMemberAgentAccess((prev) => {
                const existing = prev.find((a) => a.agentId === agentId);
                if (existing) {
                    return prev.map((a) => (a.agentId === agentId ? { ...a, allowed } : a));
                }
                return [
                    ...prev,
                    {
                        id: '',
                        workspaceId: workspace.id,
                        userId: manageMember.userId,
                        agentId,
                        allowed,
                        createdAt: new Date().toISOString(),
                    },
                ];
            });
        } catch {
            toast.error('Failed to update agent access');
        }
    };

    const handleRemoveMember = async () => {
        if (!workspace || !manageMember) return;
        if (!confirm(`Remove ${manageMember.userName || manageMember.userEmail} from this workspace?`)) return;
        setSaving(true);
        try {
            await removeMember(workspace.id, manageMember.userId);
            toast.success('Member removed');
            setManageMember(null);
            fetchData();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to remove member');
        } finally {
            setSaving(false);
        }
    };

    const getInitials = (name: string | null, email: string) => {
        if (name) return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
        return email[0].toUpperCase();
    };

    const getUsagePercent = (member: MemberWithCredits) => {
        if (!member.creditLimit || member.creditLimit === 0) return 0;
        return Math.min(100, ((member.creditsUsed || 0) / member.creditLimit) * 100);
    };

    const isAgentAllowed = (agentId: string) => {
        // Default deny — agents are off unless explicitly allowed
        const access = memberAgentAccess.find((a) => a.agentId === agentId);
        return access ? access.allowed : false;
    };

    if (loading || !authorized) {
        return (
            <div className="flex h-[calc(100vh-120px)] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                        <Users className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
                        <p className="text-sm text-muted-foreground">
                            Manage workspace members, credit limits, and agent access
                        </p>
                    </div>
                </div>
                <Button onClick={() => setShowInvite(true)} size="sm">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invite User
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-border/60 bg-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Users className="h-4 w-4 text-violet-500" />
                        <span className="text-sm font-medium text-muted-foreground">Total Members</span>
                    </div>
                    <p className="text-3xl font-bold">{members.length}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Shield className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium text-muted-foreground">Admins</span>
                    </div>
                    <p className="text-3xl font-bold">
                        {members.filter((m) => m.role === 'admin' || m.role === 'owner').length}
                    </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <Mail className="h-4 w-4 text-amber-500" />
                        <span className="text-sm font-medium text-muted-foreground">Pending Invites</span>
                    </div>
                    <p className="text-3xl font-bold">{invitations.length}</p>
                </div>
            </div>

            {/* Pending Invitations */}
            {invitations.length > 0 && (
                <div>
                    <h2 className="text-lg font-semibold mb-4">Pending Invitations</h2>
                    <div className="space-y-2">
                        {invitations.map((inv) => (
                            <div
                                key={inv.id}
                                className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-5 py-3"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                                        <Mail className="h-4 w-4 text-amber-500" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{inv.email}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Invited as{' '}
                                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ROLE_COLORS[inv.role]}`}>
                                                {inv.role}
                                            </Badge>
                                            {' '}&middot; expires {new Date(inv.expiresAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRevokeInvitation(inv.id)}
                                    className="text-red-500 hover:text-red-400 hover:bg-red-500/10 h-7 text-xs"
                                >
                                    <X className="h-3 w-3 mr-1" />
                                    Revoke
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Members Table */}
            <div>
                <h2 className="text-lg font-semibold mb-4">Workspace Members</h2>
                <div className="rounded-xl border border-border/60 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/40 bg-muted/30">
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Member</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Credit Usage</th>
                                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {members.map((member) => {
                                    const RoleIcon = ROLE_ICONS[member.role] || User;
                                    return (
                                        <tr key={member.memberId} className="border-b border-border/20 last:border-b-0">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
                                                            {getInitials(member.userName, member.userEmail)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-medium">{member.userName || 'Unknown'}</p>
                                                        <p className="text-xs text-muted-foreground">{member.userEmail}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${ROLE_COLORS[member.role]}`}>
                                                    <RoleIcon className="h-3 w-3 mr-1" />
                                                    {member.role}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3">
                                                {member.creditLimit !== null ? (
                                                    <div className="space-y-1.5 max-w-[180px]">
                                                        <div className="flex justify-between text-xs text-muted-foreground">
                                                            <span>{member.creditsUsed || 0} / {member.creditLimit}</span>
                                                            <span>{Math.round(getUsagePercent(member))}%</span>
                                                        </div>
                                                        <Progress value={getUsagePercent(member)} className="h-1.5" />
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        {member.role === 'owner' ? 'Unlimited (owner)' : 'No limit'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {member.role !== 'owner' && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => openManageMember(member)}
                                                        className="h-7 text-xs"
                                                    >
                                                        <Settings className="h-3 w-3 mr-1" />
                                                        Manage
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Invite Dialog */}
            <Dialog open={showInvite} onOpenChange={(open) => !open && handleCloseInvite()}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Invite User</DialogTitle>
                        <DialogDescription>
                            Send an invitation to join this workspace. An email will be sent, and you can also copy the invite link.
                        </DialogDescription>
                    </DialogHeader>

                    {!lastInviteLink ? (
                        <>
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="invite-email">Email Address</Label>
                                    <Input
                                        id="invite-email"
                                        type="email"
                                        placeholder="user@example.com"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                                        className="mt-1.5"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    The user will be invited as a <span className="font-medium text-foreground">member</span>. You can configure their credit limits and agent access after they join.
                                </p>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleCloseInvite}>
                                    Cancel
                                </Button>
                                <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                                    {inviting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Send Invitation
                                </Button>
                            </DialogFooter>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4">
                                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 text-center">
                                    <Check className="h-8 w-8 text-green-500 mx-auto mb-2" />
                                    <p className="text-sm font-medium">Invitation Created!</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        An email has been sent. You can also share the link below.
                                    </p>
                                </div>
                                <div>
                                    <Label>Invite Link</Label>
                                    <div className="flex gap-2 mt-1.5">
                                        <Input value={lastInviteLink} readOnly className="text-xs font-mono" />
                                        <Button variant="outline" size="icon" onClick={handleCopyLink} className="shrink-0">
                                            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleCloseInvite}>Done</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Manage Member Dialog */}
            <Dialog open={!!manageMember} onOpenChange={(open) => !open && setManageMember(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                                <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
                                    {manageMember ? getInitials(manageMember.userName, manageMember.userEmail) : '?'}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <p>{manageMember?.userName || manageMember?.userEmail}</p>
                                <p className="text-xs font-normal text-muted-foreground">{manageMember?.userEmail}</p>
                            </div>
                        </DialogTitle>
                    </DialogHeader>

                    {manageMember && (
                        <Tabs defaultValue="credits" className="mt-2">
                            <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="credits">Credits</TabsTrigger>
                                <TabsTrigger value="agents">Agents</TabsTrigger>
                                <TabsTrigger value="settings">Settings</TabsTrigger>
                            </TabsList>

                            {/* Credits Tab */}
                            <TabsContent value="credits" className="space-y-4 mt-4">
                                {manageMember.creditLimit !== null && (
                                    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">
                                                {manageMember.creditsUsed || 0} / {manageMember.creditLimit} credits used
                                            </span>
                                            <span className="font-medium">{Math.round(getUsagePercent(manageMember))}%</span>
                                        </div>
                                        <Progress value={getUsagePercent(manageMember)} className="h-2" />
                                    </div>
                                )}

                                <div>
                                    <Label htmlFor="creditLimit">Credit Limit</Label>
                                    <div className="flex gap-2 mt-1.5">
                                        <Input
                                            id="creditLimit"
                                            type="number"
                                            min="0"
                                            placeholder="e.g. 1000"
                                            value={creditLimitInput}
                                            onChange={(e) => setCreditLimitInput(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSaveCreditLimit()}
                                        />
                                        <Button onClick={handleSaveCreditLimit} disabled={saving} size="sm">
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1.5">
                                        Maximum credits this user can consume. When reached, agents stop responding.
                                    </p>
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <Button variant="outline" size="sm" onClick={handleResetCredits} disabled={saving}>
                                        <RotateCcw className="h-3 w-3 mr-1.5" />
                                        Reset Usage
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={handleRemoveCreditLimit} disabled={saving}>
                                        Remove Limit
                                    </Button>
                                </div>
                            </TabsContent>

                            {/* Agent Access Tab */}
                            <TabsContent value="agents" className="space-y-3 mt-4">
                                <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                                    <p className="text-xs text-muted-foreground">
                                        Toggle on the agents this user is allowed to use. By default, no agents are accessible.
                                    </p>
                                </div>
                                <div className="space-y-2 max-h-[280px] overflow-y-auto">
                                    {agents.map((agent) => (
                                        <div
                                            key={agent.id}
                                            className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-lg">{agent.emoji || '🤖'}</span>
                                                <div>
                                                    <p className="text-sm font-medium">{agent.name}</p>
                                                    <p className="text-xs text-muted-foreground">{agent.model}</p>
                                                </div>
                                            </div>
                                            <Switch
                                                checked={isAgentAllowed(agent.id)}
                                                onCheckedChange={(checked) => handleToggleAgentAccess(agent.id, checked)}
                                            />
                                        </div>
                                    ))}
                                    {agents.length === 0 && (
                                        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                                            <p className="text-sm text-muted-foreground">No agents in this workspace.</p>
                                        </div>
                                    )}
                                </div>
                            </TabsContent>

                            {/* Settings Tab */}
                            <TabsContent value="settings" className="space-y-4 mt-4">
                                <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                                    <p className="text-sm">
                                        Role: <Badge variant="outline" className={`${ROLE_COLORS[manageMember.role]} ml-1`}>{manageMember.role}</Badge>
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-border/40">
                                    <p className="text-sm font-medium text-red-500 mb-2">Danger Zone</p>
                                    <Button variant="destructive" size="sm" onClick={handleRemoveMember} disabled={saving}>
                                        <Trash2 className="h-3 w-3 mr-1.5" />
                                        Remove from Workspace
                                    </Button>
                                    <p className="text-xs text-muted-foreground mt-1.5">
                                        This will remove the user and all their access.
                                    </p>
                                </div>
                            </TabsContent>
                        </Tabs>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
