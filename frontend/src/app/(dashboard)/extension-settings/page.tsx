'use client';

import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Eye, EyeOff, CheckCircle, PuzzleIcon, Wifi, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { getExtensionSettings, regenerateExtensionApiKey, getExtensionDownloadUrl } from '@/lib/api/extension';
import { ACTIVE_WORKSPACE_KEY } from '@/lib/constants';
import type { ExtensionSettings } from '@/lib/api/extension';

function getActiveWorkspaceId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
        const ws = raw ? JSON.parse(raw) : null;
        return ws?.id ?? null;
    } catch {
        return null;
    }
}

export default function ExtensionSettingsPage() {
    const [settings, setSettings] = useState<ExtensionSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [showKey, setShowKey] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);

    useEffect(() => {
        const workspaceId = getActiveWorkspaceId();
        if (!workspaceId) { setLoading(false); return; }
        getExtensionSettings(workspaceId)
            .then(setSettings)
            .catch(() => toast.error('Failed to load extension settings'))
            .finally(() => setLoading(false));
    }, []);

    const copy = async (value: string, field: 'url' | 'key') => {
        try {
            await navigator.clipboard.writeText(value);
            if (field === 'url') { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); }
            else { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
            toast.success('Copied to clipboard!');
        } catch {
            toast.error('Failed to copy');
        }
    };

    const handleRegenerate = async () => {
        const workspaceId = getActiveWorkspaceId();
        if (!workspaceId) return;
        setRegenerating(true);
        try {
            const result = await regenerateExtensionApiKey(workspaceId);
            setSettings((prev) => prev ? { ...prev, apiKey: result.apiKey } : prev);
            setConfirmOpen(false);
            toast.success('API key regenerated! Update your Chrome extension.');
        } catch {
            toast.error('Failed to regenerate key');
        } finally {
            setRegenerating(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-8">
            {/* Header */}
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <PuzzleIcon className="h-6 w-6 text-primary" />
                    <h1 className="text-2xl font-bold tracking-tight">Chrome Extension</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                    Connect your Chrome Browser Agent extension to this workspace using the credentials below.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
            ) : !settings ? (
                <p className="text-muted-foreground">No workspace selected.</p>
            ) : (
                <div className="rounded-xl border border-border bg-card shadow-sm">
                    {/* Connection status badge */}
                    <div className="flex items-center gap-2 border-b border-border px-6 py-4">
                        <Wifi className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Connection Credentials</span>
                    </div>

                    <div className="space-y-6 p-6">
                        {/* WebSocket URL */}
                        {/* <div className="space-y-2">
                            <Label htmlFor="ws-url" className="text-sm font-medium">
                                WebSocket URL
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Paste this into the &quot;Server URL&quot; field in the extension popup.
                            </p>
                            <div className="flex gap-2">
                                <Input
                                    id="ws-url"
                                    readOnly
                                    value={settings.wsUrl}
                                    className="font-mono text-sm bg-muted/40"
                                />
                                <Button
                                    id="copy-ws-url"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => copy(settings.wsUrl, 'url')}
                                    title="Copy URL"
                                >
                                    {copiedUrl ? (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div> */}

                        {/* API Key */}
                        <div className="space-y-2">
                            <Label htmlFor="api-key" className="text-sm font-medium">
                                API Key
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Paste this into the &quot;API Key&quot; field in the extension popup. Keep it secret.
                            </p>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        id="api-key"
                                        readOnly
                                        type={showKey ? 'text' : 'password'}
                                        value={settings.apiKey}
                                        className="font-mono text-sm bg-muted/40 pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowKey((s) => !s)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        title={showKey ? 'Hide' : 'Reveal'}
                                    >
                                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <Button
                                    id="copy-api-key"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => copy(settings.apiKey, 'key')}
                                    title="Copy API Key"
                                >
                                    {copiedKey ? (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                    ) : (
                                        <Copy className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Regenerate */}
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                            <div>
                                <p className="text-sm font-medium">Regenerate API Key</p>
                                <p className="text-xs text-muted-foreground">
                                    Your old key will stop working immediately.
                                </p>
                            </div>
                            <Button
                                id="regenerate-key"
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmOpen(true)}
                                className="gap-2 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Regenerate
                            </Button>
                        </div>
                    </div>

                    {/* Download Extension */}
                    <div className="border-t border-border px-6 py-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">Download Browser Agent Extension</p>
                                <p className="text-xs text-muted-foreground">
                                    Download the Chrome extension as a .zip file and load it in Developer Mode.
                                </p>
                            </div>
                            <Button
                                asChild
                                variant="default"
                                size="sm"
                                className="gap-2"
                            >
                                <a href={getExtensionDownloadUrl()} download>
                                    <Download className="h-3.5 w-3.5" />
                                    Download .zip
                                </a>
                            </Button>
                        </div>
                    </div>

                    {/* How to connect */}
                    <div className="border-t border-border bg-muted/20 px-6 py-5 rounded-b-xl">
                        <p className="mb-3 text-sm font-medium">How to connect your extension</p>
                        <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                            <li>Download and unzip the <strong>Browser Agent</strong> extension using the button above.</li>
                            <li>Go to <strong>chrome://extensions</strong>, enable <strong>Developer Mode</strong>, and click <strong>Load unpacked</strong>.</li>
                            <li>Select the unzipped extension folder.</li>
                            <li>Click the extension icon in your Chrome toolbar.</li>
                            {/* <li>Paste the <strong>WebSocket URL</strong> into the &quot;Server URL&quot; field.</li> */}
                            <li>Paste the <strong>API Key</strong> into the &quot;API Key&quot; field.</li>
                            <li>Click <strong>Connect</strong> — the status should turn green.</li>
                        </ol>
                    </div>
                </div>
            )}

            {/* Confirm regenerate dialog */}
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Regenerate API Key?</DialogTitle>
                        <DialogDescription>
                            Your current API key will be invalidated immediately. You will need to update
                            the key in your Chrome extension popup to reconnect.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            id="confirm-regenerate"
                            variant="destructive"
                            onClick={handleRegenerate}
                            disabled={regenerating}
                        >
                            {regenerating ? 'Regenerating...' : 'Yes, Regenerate'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
