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
    Mail,
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
    const [email, setEmail] = useState('');
    const [masterPassword, setMasterPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [connecting, setConnecting] = useState(false);

    // Device verification
    const [needsVerification, setNeedsVerification] = useState(false);
    const [verificationCode, setVerificationCode] = useState('');

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
                email,
                masterPassword,
                ...(verificationCode ? { verificationCode } : {}),
            });
            toast.success('Bitwarden vault connected successfully!');
            setConnectOpen(false);
            setEmail('');
            setMasterPassword('');
            setVerificationCode('');
            setNeedsVerification(false);
            fetchStatus();
        } catch (err: unknown) {
            const error = err as {
                response?: {
                    data?: { error?: { message?: string; code?: string } };
                };
            };
            const code = error?.response?.data?.error?.code;
            const msg =
                error?.response?.data?.error?.message ||
                'Failed to connect vault';

            if (code === 'DEVICE_VERIFICATION_REQUIRED') {
                setNeedsVerification(true);
                setVerificationCode('');
                toast.info(
                    'Check your email for a verification code from Bitwarden.'
                );
            } else if (code === 'DEVICE_VERIFICATION_INVALID') {
                setNeedsVerification(true);
                setVerificationCode('');
                toast.error(
                    'Verification code is invalid or expired. Check your email for a new code.'
                );
            } else {
                toast.error(msg);
            }
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
                                            Connected as{' '}
                                            <span className="font-medium text-foreground">
                                                {vaultStatus.email}
                                            </span>
                                            . Agents can access login items
                                            during tasks. Your master password
                                            is not stored.
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
                                                This will remove all stored
                                                tokens and vault keys. Agents
                                                will no longer be able to access
                                                your passwords during automation
                                                tasks. You can reconnect at any
                                                time.
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
                                    Connect your Bitwarden vault so agents can
                                    securely fetch login credentials when
                                    automating tasks that require
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
                            Enter Your Credentials
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Enter your Bitwarden email and master password.
                            Your password is used once to derive a vault key,
                            then immediately discarded.
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            2
                        </div>
                        <p className="text-sm font-medium">
                            Secure Key Derivation
                        </p>
                        <p className="text-xs text-muted-foreground">
                            We authenticate with Bitwarden, derive your vault
                            decryption key, and store only encrypted tokens.
                            Your master password is never stored or logged.
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
                            automatically fetches the right credentials from
                            your vault. Tokens refresh silently — no password
                            needed again.
                        </p>
                    </div>
                </div>
            </div>

            {/* Connect Dialog */}
            <Dialog
                open={connectOpen}
                onOpenChange={(open) => {
                    setConnectOpen(open);
                    if (!open) {
                        setNeedsVerification(false);
                        setVerificationCode('');
                    }
                }}
            >
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
                            Sign in with your Bitwarden account to securely
                            connect your vault for automated credential access.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Security Notice */}
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-sm">
                        <div className="flex items-start gap-2">
                            <Shield className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="space-y-1">
                                <p className="font-medium text-blue-700 dark:text-blue-400">
                                    Your Master Password Is Never Stored
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Your master password is used once to derive
                                    a vault decryption key, then immediately
                                    discarded. Only encrypted OAuth tokens and
                                    the derived key are stored — protected with
                                    AES-256-GCM encryption at rest.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 py-2">
                        {/* Email */}
                        <div className="space-y-2">
                            <Label htmlFor="bw-email">
                                Bitwarden Email
                            </Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="bw-email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                The email address for your Bitwarden account
                            </p>
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
                                        showPassword ? 'text' : 'password'
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
                                Used once to derive your vault key — never
                                stored or logged anywhere.
                            </p>
                        </div>

                        {/* Verification Code (shown after device verification required) */}
                        {needsVerification && (
                            <div className="space-y-2">
                                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-sm">
                                    <div className="flex items-start gap-2">
                                        <Mail className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                        <div className="space-y-1">
                                            <p className="font-medium text-amber-700 dark:text-amber-400">
                                                Device Verification Required
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                Bitwarden sent a verification
                                                code to{' '}
                                                <span className="font-medium">
                                                    {email}
                                                </span>
                                                . Enter it below to continue.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <Label htmlFor="bw-verification-code">
                                    Verification Code
                                </Label>
                                <Input
                                    id="bw-verification-code"
                                    type="text"
                                    placeholder="Enter code from email"
                                    value={verificationCode}
                                    onChange={(e) =>
                                        setVerificationCode(e.target.value)
                                    }
                                    autoFocus
                                />
                            </div>
                        )}
                    </div>

                    <DialogFooter className="flex items-center justify-between sm:justify-between">
                        <a
                            href="https://vault.bitwarden.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                        >
                            <ExternalLink className="h-3 w-3" />
                            Open Bitwarden
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
                                    !email.trim() ||
                                    !masterPassword.trim() ||
                                    (needsVerification &&
                                        !verificationCode.trim())
                                }
                                className="gap-1.5 bg-[#175DDC] hover:bg-[#1452c4]"
                            >
                                {connecting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Lock className="h-4 w-4" />
                                )}
                                {connecting
                                    ? 'Verifying...'
                                    : needsVerification
                                      ? 'Verify & Connect'
                                      : 'Connect Bitwarden'}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
