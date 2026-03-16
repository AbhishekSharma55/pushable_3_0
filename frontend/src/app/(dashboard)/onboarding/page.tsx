'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { createWorkspace, getWorkspaces } from '@/lib/api/workspaces';
import { WORKSPACES_KEY, ACTIVE_WORKSPACE_KEY } from '@/lib/constants';

export default function OnboardingPage() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        // If user already has workspaces, redirect
        const check = async () => {
            try {
                const workspaces = await getWorkspaces();
                if (workspaces.length > 0) {
                    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
                    localStorage.setItem(
                        ACTIVE_WORKSPACE_KEY,
                        JSON.stringify(workspaces[0])
                    );
                    router.push('/');
                }
            } catch {
                // Ignore
            }
        };
        check();
    }, [router]);

    const handleCreate = async () => {
        if (!name.trim()) return;
        setCreating(true);
        try {
            const ws = await createWorkspace({ name: name.trim() });
            localStorage.setItem(WORKSPACES_KEY, JSON.stringify([ws]));
            localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify(ws));
            toast.success('Workspace created! Let\'s go 🚀');
            router.push('/');
        } catch {
            toast.error('Failed to create workspace');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
            <Card className="w-full max-w-md border-border/50 shadow-xl">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                        <Rocket className="h-7 w-7 text-primary" />
                    </div>
                    <CardTitle className="text-2xl font-bold">
                        Create your first workspace
                    </CardTitle>
                    <CardDescription>
                        A workspace is where your AI agents, knowledge bases, and
                        tools live.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="onboarding-name">Workspace name</Label>
                        <Input
                            id="onboarding-name"
                            placeholder="e.g. My Company"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        />
                    </div>
                    <Button
                        id="onboarding-submit"
                        className="w-full"
                        onClick={handleCreate}
                        disabled={creating || !name.trim()}
                    >
                        {creating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Creating...
                            </>
                        ) : (
                            'Create Workspace'
                        )}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
