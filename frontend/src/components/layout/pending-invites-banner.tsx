'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, X, Loader2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getMyPendingInvitations, acceptInvitation, type PendingInvite } from '@/lib/api/members';
import { WORKSPACES_KEY, ACTIVE_WORKSPACE_KEY } from '@/lib/constants';

export function PendingInvitesBanner() {
    const router = useRouter();
    const [invites, setInvites] = useState<PendingInvite[]>([]);
    const [accepting, setAccepting] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    useEffect(() => {
        getMyPendingInvitations()
            .then(setInvites)
            .catch(() => {});
    }, []);

    const handleAccept = async (invite: PendingInvite) => {
        setAccepting(invite.id);
        try {
            const result = await acceptInvitation(invite.token);
            toast.success(`Joined ${invite.workspaceName}!`);
            setInvites((prev) => prev.filter((i) => i.id !== invite.id));

            // Update workspaces in localStorage
            if (result.workspace) {
                try {
                    const existing = JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]');
                    if (!existing.find((w: any) => w.id === result.workspace.id)) {
                        existing.push(result.workspace);
                        localStorage.setItem(WORKSPACES_KEY, JSON.stringify(existing));
                    }
                    localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(result.workspace));
                } catch {}
            }

            // Reload to pick up the new workspace
            window.location.reload();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to accept invitation');
        } finally {
            setAccepting(null);
        }
    };

    const handleDismiss = (id: string) => {
        setDismissed((prev) => new Set(prev).add(id));
    };

    const visible = invites.filter((i) => !dismissed.has(i.id));
    if (visible.length === 0) return null;

    return (
        <div className="space-y-2 mb-4">
            {visible.map((invite) => (
                <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3"
                >
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                            <Mail className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                                You&apos;re invited to join <span className="text-blue-400">{invite.workspaceName}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                                as {invite.role} — expires {new Date(invite.expiresAt).toLocaleDateString()}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            size="sm"
                            onClick={() => handleAccept(invite)}
                            disabled={accepting === invite.id}
                            className="h-7 text-xs"
                        >
                            {accepting === invite.id ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                                <CheckCircle className="h-3 w-3 mr-1" />
                            )}
                            Accept
                        </Button>
                        <button
                            onClick={() => handleDismiss(invite.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
