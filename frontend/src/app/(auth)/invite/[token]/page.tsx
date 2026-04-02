'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, CheckCircle, XCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getToken } from '@/lib/auth';
import { getInvitationDetails, acceptInvitation } from '@/lib/api/members';
import { WORKSPACES_KEY, ACTIVE_WORKSPACE_KEY } from '@/lib/constants';
import type { InvitationDetails } from '@/types';

export default function InviteAcceptPage() {
    const params = useParams();
    const router = useRouter();
    const token = params.token as string;

    const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [accepting, setAccepting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accepted, setAccepted] = useState(false);

    useEffect(() => {
        const authToken = getToken();
        if (!authToken) {
            // Not logged in — redirect to login with invite token
            router.push(`/login?invite=${token}`);
            return;
        }

        // Fetch invitation details
        getInvitationDetails(token)
            .then((details) => {
                if (details.status === 'accepted') {
                    setAccepted(true);
                } else if (details.status !== 'pending') {
                    setError(`This invitation has been ${details.status}.`);
                } else if (new Date(details.expiresAt) < new Date()) {
                    setError('This invitation has expired. Please request a new one.');
                } else {
                    setInvitation(details);
                }
            })
            .catch((err) => {
                setError(err?.response?.data?.message || 'Invitation not found.');
            })
            .finally(() => setLoading(false));
    }, [token, router]);

    const handleAccept = async () => {
        setAccepting(true);
        try {
            const result = await acceptInvitation(token);
            toast.success('You have joined the workspace!');
            setAccepted(true);

            // Refresh workspaces in localStorage so the sidebar picks it up
            if (result.workspace) {
                try {
                    const existing = JSON.parse(
                        localStorage.getItem(WORKSPACES_KEY) || '[]'
                    );
                    if (!existing.find((w: any) => w.id === result.workspace.id)) {
                        existing.push(result.workspace);
                        localStorage.setItem(WORKSPACES_KEY, JSON.stringify(existing));
                    }
                    localStorage.setItem(
                        ACTIVE_WORKSPACE_KEY,
                        JSON.stringify(result.workspace)
                    );
                } catch {}
            }

            // Redirect to dashboard after a short delay
            setTimeout(() => router.push('/'), 1500);
        } catch (err: any) {
            const msg =
                err?.response?.data?.message || 'Failed to accept invitation.';
            setError(msg);
            toast.error(msg);
        } finally {
            setAccepting(false);
        }
    };

    if (loading) {
        return (
            <Card className="border-border/50 shadow-xl max-w-md mx-auto">
                <CardContent className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
                </CardContent>
            </Card>
        );
    }

    if (accepted) {
        return (
            <Card className="border-border/50 shadow-xl max-w-md mx-auto">
                <CardContent className="text-center py-12 space-y-4">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                    <h2 className="text-xl font-semibold text-white">
                        You&apos;re in!
                    </h2>
                    <p className="text-zinc-400 text-sm">
                        Redirecting to your workspace...
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="border-border/50 shadow-xl max-w-md mx-auto">
                <CardContent className="text-center py-12 space-y-4">
                    <XCircle className="h-12 w-12 text-red-500 mx-auto" />
                    <h2 className="text-xl font-semibold text-white">
                        Unable to join
                    </h2>
                    <p className="text-zinc-400 text-sm">{error}</p>
                    <Button
                        variant="outline"
                        onClick={() => router.push('/login')}
                    >
                        Go to Login
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-border/50 shadow-xl max-w-md mx-auto">
            <CardHeader className="text-center space-y-1">
                <div className="flex justify-center mb-2">
                    <Mail className="h-10 w-10 text-blue-500" />
                </div>
                <CardTitle className="text-2xl font-bold">
                    Workspace Invitation
                </CardTitle>
                <CardDescription>
                    You&apos;ve been invited to join a workspace
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-zinc-400">Workspace</span>
                        <span className="text-sm font-medium text-white">
                            {invitation?.workspaceName}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-zinc-400">Role</span>
                        <Badge variant="outline" className="capitalize">
                            {invitation?.role}
                        </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-zinc-400">Invited as</span>
                        <span className="text-sm text-zinc-300">
                            {invitation?.email}
                        </span>
                    </div>
                </div>

                <Button
                    className="w-full"
                    onClick={handleAccept}
                    disabled={accepting}
                    size="lg"
                >
                    {accepting && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Accept Invitation
                </Button>
            </CardContent>
        </Card>
    );
}
