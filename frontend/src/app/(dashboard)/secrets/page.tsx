'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    KeyRound,
    Shield,
    Loader2,
    CheckCircle,
    XCircle,
    Trash2,
    RefreshCw,
    Lock,
    Eye,
    EyeOff,
    ExternalLink,
    Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    getVaultStatus,
    connectVault,
    testVault,
    disconnectVault,
} from '@/lib/api/vault';
import type { VaultStatus } from '@/lib/api/vault';

export default function SecretsPage() {
    const workspace = useActiveWorkspace();

    const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
    const [loading, setLoading] = useState(true);

    // Connect dialog
    const [connectOpen, setConnectOpen] = useState(false);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [masterPassword, setMasterPassword] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [connecting, setConnecting] = useState(false);

    // Test connection
    const [testing, setTesting] = useState(false);

    const fetchStatus = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const status = await getVaultStatus(workspace.id);
            setVaultStatus(status);
        } catch {
            toast.error('Failed to load vault status');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleConnect = async () => {
        if (!workspace) return;
        try {
            setConnecting(true);
            await connectVault(workspace.id, {
                provider: 'bitwarden',
                clientId,
                clientSecret,
                masterPassword,
            });
            toast.success('Bitwarden vault connected successfully!');
            setConnectOpen(false);
            setClientId('');
            setClientSecret('');
            setMasterPassword('');
            fetchStatus();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            const msg = error?.response?.data?.error?.message || 'Failed to connect vault';
            toast.error(msg);
        } finally {
            setConnecting(false);
        }
    };

    const handleTest = async () => {
        if (!workspace) return;
        try {
            setTesting(true);
            const result = await testVault(workspace.id);
            if (result.success) {
                toast.success('Vault connection is working!');
            } else {
                toast.error(`Connection test failed: ${result.error}`);
            }
            fetchStatus();
        } catch {
            toast.error('Failed to test vault connection');
        } finally {
            setTesting(false);
        }
    };

    const handleDisconnect = async () => {
        if (!workspace) return;
        try {
            await disconnectVault(workspace.id);
            toast.success('Vault disconnected');
            fetchStatus();
        } catch {
            toast.error('Failed to disconnect vault');
        }
    };

    const statusBadge = (status?: string) => {
        switch (status) {
            case 'active':
                return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
            case 'failed':
                return 'bg-red-500/10 text-red-600 border-red-500/20';
            default:
                return 'bg-muted text-muted-foreground';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                    <KeyRound className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        Secrets Management
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Connect your password vault so AI agents can securely
                        access credentials during automation tasks.
                    </p>
                </div>
            </div>

            {/* Bitwarden Integration Section */}
            <div className="rounded-lg border border-border/60 bg-card">
                <div className="border-b border-border/40 px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <svg
                                    viewBox="0 0 32 32"
                                    className="h-5 w-5"
                                    fill="none"
                                >
                                    <rect
                                        width="32"
                                        height="32"
                                        rx="6"
                                        fill="#175DDC"
                                    />
                                    <path
                                        d="M8 8h16v3.2l-8 10.4L8 11.2V8z"
                                        fill="white"
                                    />
                                    <path
                                        d="M16 21.6L8 11.2V24l8 0 8 0V11.2l-8 10.4z"
                                        fill="white"
                                        opacity="0.7"
                                    />
                                </svg>
                                Bitwarden Integration
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Connect your Bitwarden vault to access
                                credentials during task execution.
                            </p>
                        </div>
                        {!vaultStatus?.connected && (
                            <Button
                                onClick={() => setConnectOpen(true)}
                                className="gap-1.5 bg-[#175DDC] hover:bg-[#1452c4]"
                            >
                                <Lock className="h-4 w-4" />
                                Connect Bitwarden
                            </Button>
                        )}
                    </div>
                </div>

                <div className="px-6 py-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : vaultStatus?.connected ? (
                        /* Connected State */
                        <div className="space-y-4">
                            <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <CheckCircle className="h-5 w-5 text-emerald-600" />
                                    <div>
                                        <p className="text-sm font-medium">
                                            Bitwarden Vault Connected
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Your vault credentials are
                                            encrypted and stored securely.
                                            Agents can now access login
                                            items during tasks.
                                        </p>
                                    </div>
                                </div>
                                <Badge
                                    variant="outline"
                                    className={`text-xs ${statusBadge(vaultStatus.status)}`}
                                >
                                    {vaultStatus.status}
                                </Badge>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleTest}
                                    disabled={testing}
                                    className="gap-1.5"
                                >
                                    {testing ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    )}
                                    Test Connection
                                </Button>

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5 text-destructive hover:text-destructive"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Disconnect
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>
                                                Disconnect Bitwarden Vault
                                            </AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will remove your stored
                                                vault credentials. Agents will
                                                no longer be able to access
                                                your passwords during
                                                automation tasks.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>
                                                Cancel
                                            </AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={handleDisconnect}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                Disconnect
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    ) : (
                        /* Disconnected State */
                        <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center">
                                <Shield className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">
                                    No vault integration configured
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
                                    Connect your Bitwarden vault so agents
                                    can securely fetch login credentials
                                    when automating tasks that require
                                    authentication.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* How it works section */}
            <div className="rounded-lg border border-border/60 bg-card px-6 py-5">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    How It Works
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            1
                        </div>
                        <p className="text-sm font-medium">
                            Get your API Key
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Go to{' '}
                            <a
                                href="https://vault.bitwarden.com/#/settings/security/security-keys"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline underline-offset-2"
                            >
                                vault.bitwarden.com
                            </a>{' '}
                            → Settings → Security → Keys → View API Key
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            2
                        </div>
                        <p className="text-sm font-medium">
                            Connect Once
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Enter your client_id, client_secret, and
                            master password. They&apos;re encrypted with
                            AES-256 and stored securely.
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            3
                        </div>
                        <p className="text-sm font-medium">
                            Agents Auto-Fetch
                        </p>
                        <p className="text-xs text-muted-foreground">
                            When a task requires login, the agent
                            automatically fetches the right credentials
                            from your vault by item name.
                        </p>
                    </div>
                </div>
            </div>

            {/* Connect Dialog */}
            <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <svg
                                viewBox="0 0 32 32"
                                className="h-5 w-5"
                                fill="none"
                            >
                                <rect
                                    width="32"
                                    height="32"
                                    rx="6"
                                    fill="#175DDC"
                                />
                                <path
                                    d="M8 8h16v3.2l-8 10.4L8 11.2V8z"
                                    fill="white"
                                />
                                <path
                                    d="M16 21.6L8 11.2V24l8 0 8 0V11.2l-8 10.4z"
                                    fill="white"
                                    opacity="0.7"
                                />
                            </svg>
                            Connect Bitwarden Vault
                        </DialogTitle>
                        <DialogDescription>
                            Enter your Bitwarden API credentials to
                            securely connect your vault for automated
                            credential access.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Security Notice */}
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-sm">
                        <div className="flex items-start gap-2">
                            <Shield className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="space-y-1">
                                <p className="font-medium text-blue-700 dark:text-blue-400">
                                    Security Notice
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Your credentials will be encrypted
                                    using AES-256-GCM and stored securely.
                                    They are only decrypted momentarily
                                    when an agent needs to fetch a
                                    credential.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 py-2">
                        {/* Client ID */}
                        <div className="space-y-2">
                            <Label htmlFor="bw-client-id">
                                Client ID
                            </Label>
                            <Input
                                id="bw-client-id"
                                placeholder="user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                value={clientId}
                                onChange={(e) =>
                                    setClientId(e.target.value)
                                }
                                className="font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Starts with{' '}
                                <code className="px-1 py-0.5 rounded bg-muted">
                                    user.
                                </code>{' '}
                                — found in your API Key dialog
                            </p>
                        </div>

                        {/* Client Secret */}
                        <div className="space-y-2">
                            <Label htmlFor="bw-client-secret">
                                Client Secret
                            </Label>
                            <div className="relative">
                                <Input
                                    id="bw-client-secret"
                                    type={
                                        showSecret ? 'text' : 'password'
                                    }
                                    placeholder="Your client secret"
                                    value={clientSecret}
                                    onChange={(e) =>
                                        setClientSecret(e.target.value)
                                    }
                                    className="font-mono text-sm pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowSecret(!showSecret)
                                    }
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                                >
                                    {showSecret ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Master Password */}
                        <div className="space-y-2">
                            <Label htmlFor="bw-master-password">
                                Master Password
                            </Label>
                            <div className="relative">
                                <Input
                                    id="bw-master-password"
                                    type={
                                        showPassword
                                            ? 'text'
                                            : 'password'
                                    }
                                    placeholder="Your Bitwarden master password"
                                    value={masterPassword}
                                    onChange={(e) =>
                                        setMasterPassword(e.target.value)
                                    }
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setShowPassword(!showPassword)
                                    }
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Required to decrypt your vault — Bitwarden
                                uses end-to-end encryption.
                            </p>
                        </div>
                    </div>

                    <DialogFooter className="flex items-center justify-between sm:justify-between">
                        <a
                            href="https://vault.bitwarden.com/#/settings/security/security-keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Get API Key
                        </a>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setConnectOpen(false)}
                                disabled={connecting}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleConnect}
                                disabled={
                                    connecting ||
                                    !clientId.trim() ||
                                    !clientSecret.trim() ||
                                    !masterPassword.trim()
                                }
                                className="gap-1.5 bg-[#175DDC] hover:bg-[#1452c4]"
                            >
                                {connecting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Lock className="h-4 w-4" />
                                )}
                                {connecting
                                    ? 'Connecting...'
                                    : 'Connect Bitwarden'}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
