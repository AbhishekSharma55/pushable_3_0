'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Mail,
    Plus,
    Trash2,
    Loader2,
    Save,
    Settings,
    Shield,
    Copy,
    RefreshCw,
    Check,
    Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
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
    getEmailAddress,
    updateEmailAddress,
    deleteEmailAddress,
    regenerateEmailAddress,
    generateEmailAddress,
    getApprovedSenders,
    addApprovedSender,
    removeApprovedSender,
} from '@/lib/api/email';
import type { EmailWorkspaceAddress, EmailApprovedSender } from '@/lib/api/email';

export default function EmailSettingsPage() {
    const workspace = useActiveWorkspace();
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [editingAddress, setEditingAddress] = useState(false);
    const [addressInput, setAddressInput] = useState('');

    // Email address state
    const [emailConfig, setEmailConfig] = useState<EmailWorkspaceAddress | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [customInstructions, setCustomInstructions] = useState('');
    const [settingsSaving, setSettingsSaving] = useState(false);

    const domain = process.env.NEXT_PUBLIC_EMAIL_DOMAIN || emailConfig?.address.split('@')[1] || 'pushable.ai';

    // Approved senders state
    const [senders, setSenders] = useState<EmailApprovedSender[]>([]);
    const [showAddSender, setShowAddSender] = useState(false);
    const [newSenderPattern, setNewSenderPattern] = useState('');
    const [newSenderNote, setNewSenderNote] = useState('');
    const [senderSaving, setSenderSaving] = useState(false);

    const fetchData = useCallback(async () => {
        if (!workspace?.id) return;
        setLoading(true);
        try {
            const [addr, senderList] = await Promise.all([
                getEmailAddress(workspace.id),
                getApprovedSenders(workspace.id),
            ]);
            setEmailConfig(addr);
            if (addr) {
                setDisplayName(addr.displayName || '');
                setCustomInstructions(addr.customInstructions || '');
            }
            setSenders(senderList);
        } catch {
            toast.error('Failed to load email settings');
        } finally {
            setLoading(false);
        }
    }, [workspace?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleGenerate = async () => {
        if (!workspace?.id) return;
        setGenerating(true);
        try {
            const created = await generateEmailAddress(workspace.id);
            setEmailConfig(created);
            setDisplayName(created.displayName || '');
            setCustomInstructions(created.customInstructions || '');
            toast.success('Email address generated');
        } catch {
            toast.error('Failed to generate email address');
        } finally {
            setGenerating(false);
        }
    };

    const handleSaveAddress = async () => {
        if (!workspace?.id || !emailConfig || !addressInput.trim()) return;
        const newAddress = `${addressInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')}@${domain}`;
        setSettingsSaving(true);
        try {
            const updated = await updateEmailAddress(workspace.id, { address: newAddress });
            setEmailConfig(updated);
            setEditingAddress(false);
            toast.success('Email address updated');
        } catch {
            toast.error('Failed to update email address');
        } finally {
            setSettingsSaving(false);
        }
    };

    const handleCopyAddress = () => {
        if (!emailConfig?.address) return;
        navigator.clipboard.writeText(emailConfig.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleRegenerate = async () => {
        if (!workspace?.id) return;
        setRegenerating(true);
        try {
            const updated = await regenerateEmailAddress(workspace.id);
            setEmailConfig(updated);
            toast.success('New email address generated');
        } catch {
            toast.error('Failed to regenerate email address');
        } finally {
            setRegenerating(false);
        }
    };

    const handleSaveSettings = async () => {
        if (!workspace?.id || !emailConfig) return;
        setSettingsSaving(true);
        try {
            const updated = await updateEmailAddress(workspace.id, {
                displayName: displayName || null,
                customInstructions: customInstructions || null,
            });
            setEmailConfig(updated);
            toast.success('Settings saved');
        } catch {
            toast.error('Failed to save settings');
        } finally {
            setSettingsSaving(false);
        }
    };

    const handleToggleEnabled = async (enabled: boolean) => {
        if (!workspace?.id || !emailConfig) return;
        try {
            const updated = await updateEmailAddress(workspace.id, { enabled });
            setEmailConfig(updated);
            toast.success(enabled ? 'Email enabled' : 'Email disabled');
        } catch {
            toast.error('Failed to update');
        }
    };

    const handleDeleteAddress = async () => {
        if (!workspace?.id) return;
        try {
            await deleteEmailAddress(workspace.id);
            setEmailConfig(null);
            setDisplayName('');
            setCustomInstructions('');
            toast.success('Email address removed');
        } catch {
            toast.error('Failed to delete email address');
        }
    };

    const handleAddSender = async () => {
        if (!workspace?.id || !newSenderPattern.trim()) return;
        setSenderSaving(true);
        try {
            const sender = await addApprovedSender(workspace.id, {
                senderPattern: newSenderPattern.trim(),
                note: newSenderNote.trim() || undefined,
            });
            setSenders(prev => [...prev, sender]);
            setNewSenderPattern('');
            setNewSenderNote('');
            setShowAddSender(false);
            toast.success('Approved sender added');
        } catch {
            toast.error('Failed to add sender');
        } finally {
            setSenderSaving(false);
        }
    };

    const handleRemoveSender = async (id: string) => {
        if (!workspace?.id) return;
        try {
            await removeApprovedSender(workspace.id, id);
            setSenders(prev => prev.filter(s => s.id !== id));
            toast.success('Sender removed');
        } catch {
            toast.error('Failed to remove sender');
        }
    };

    if (!workspace) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    }

    return (
        <div className="max-w-3xl mx-auto p-6 space-y-8">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Settings className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-lg font-semibold">Email Settings</h1>
            </div>

            {loading ? (
                <div className="space-y-4">
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="h-40 w-full" />
                </div>
            ) : (
                <>
                    {/* Workspace Email Address */}
                    <div className="rounded-lg border border-border p-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-muted-foreground" />
                                <h2 className="text-sm font-semibold">Workspace Email Address</h2>
                            </div>
                            {emailConfig && (
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">
                                        {emailConfig.enabled ? 'Active' : 'Disabled'}
                                    </span>
                                    <Switch
                                        checked={emailConfig.enabled}
                                        onCheckedChange={handleToggleEnabled}
                                    />
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Remove email address?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This will disconnect email from your workspace. Incoming emails will no longer be processed.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={handleDeleteAddress}>Remove</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            )}
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Send emails to this address to trigger your CEO agent. The CEO will analyze and delegate to the right specialist.
                        </p>

                        {emailConfig ? (
                            <>
                                {/* Auto-generated address display */}
                                <div className="rounded-lg bg-muted/50 border border-border p-4 space-y-3">
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Your workspace email</p>

                                    {editingAddress ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-1">
                                                <Input
                                                    autoFocus
                                                    value={addressInput}
                                                    onChange={e => setAddressInput(e.target.value)}
                                                    placeholder="my-workspace"
                                                    className="font-mono text-sm"
                                                />
                                                <span className="text-sm text-muted-foreground shrink-0">@{domain}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={handleSaveAddress} disabled={settingsSaving || !addressInput.trim()}>
                                                    {settingsSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                                    Save
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={() => setEditingAddress(false)}>
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 text-sm font-mono text-foreground bg-background border border-border rounded px-3 py-2">
                                                {emailConfig.address}
                                            </code>
                                            <Button variant="outline" size="sm" onClick={handleCopyAddress} className="shrink-0">
                                                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="shrink-0"
                                                onClick={() => {
                                                    setAddressInput(emailConfig.address.split('@')[0]);
                                                    setEditingAddress(true);
                                                }}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" size="sm" className="shrink-0" disabled={regenerating}>
                                                        {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Regenerate email address?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will generate a new email address. Your old address will stop working immediately.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={handleRegenerate}>Regenerate</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                        Share this address with people who should be able to create tasks by email.
                                    </p>
                                </div>

                                {/* Settings */}
                                <div className="space-y-3">
                                    <div>
                                        <Label htmlFor="display-name" className="text-xs">Display Name (optional)</Label>
                                        <Input
                                            id="display-name"
                                            placeholder="Acme AI Team"
                                            value={displayName}
                                            onChange={e => setDisplayName(e.target.value)}
                                            className="mt-1"
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="instructions" className="text-xs">Custom Instructions (optional)</Label>
                                        <Textarea
                                            id="instructions"
                                            placeholder="Instructions prepended to every email before the CEO agent processes it..."
                                            value={customInstructions}
                                            onChange={e => setCustomInstructions(e.target.value)}
                                            rows={3}
                                            className="mt-1"
                                        />
                                    </div>
                                    <Button
                                        onClick={handleSaveSettings}
                                        disabled={settingsSaving}
                                        size="sm"
                                    >
                                        {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                                        Save Settings
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-8 text-muted-foreground space-y-3">
                                <Mail className="h-8 w-8 mx-auto opacity-30" />
                                <p className="text-sm">No email address configured</p>
                                <p className="text-xs">Generate a workspace email address to start receiving emails from the outside world.</p>
                                <Button onClick={handleGenerate} disabled={generating} size="sm">
                                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />}
                                    Generate Email Address
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Approved Senders */}
                    <div className="rounded-lg border border-border p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Shield className="h-4 w-4 text-muted-foreground" />
                                <h2 className="text-sm font-semibold">Approved Senders</h2>
                            </div>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setShowAddSender(true)}
                            >
                                <Plus className="h-4 w-4 mr-1" />
                                Add Sender
                            </Button>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Only emails from approved addresses or domains will create tasks. Others are marked as spam.
                            Use <code className="bg-muted px-1 rounded">*@domain.com</code> to approve an entire domain.
                        </p>

                        {senders.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">No approved senders configured</p>
                                <p className="text-xs mt-1">Add senders to allow emails to create tasks</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-border rounded-lg border border-border">
                                {senders.map(sender => (
                                    <div key={sender.id} className="flex items-center justify-between px-4 py-2.5">
                                        <div>
                                            <span className="text-sm font-mono">{sender.senderPattern}</span>
                                            {sender.note && (
                                                <span className="text-xs text-muted-foreground ml-2">
                                                    ({sender.note})
                                                </span>
                                            )}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveSender(sender.id)}
                                            className="text-red-400 hover:text-red-300 h-7 w-7 p-0"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Add Sender Sheet */}
            <Sheet open={showAddSender} onOpenChange={setShowAddSender}>
                <SheetContent>
                    <SheetHeader>
                        <SheetTitle>Add Approved Sender</SheetTitle>
                        <SheetDescription>
                            Add an email address or domain pattern to the approved senders list.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="space-y-4 mt-6">
                        <div>
                            <Label htmlFor="sender-pattern" className="text-xs">
                                Email or Pattern
                            </Label>
                            <Input
                                id="sender-pattern"
                                placeholder="john@example.com or *@company.com"
                                value={newSenderPattern}
                                onChange={e => setNewSenderPattern(e.target.value)}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label htmlFor="sender-note" className="text-xs">
                                Note (optional)
                            </Label>
                            <Input
                                id="sender-note"
                                placeholder="Sales team lead"
                                value={newSenderNote}
                                onChange={e => setNewSenderNote(e.target.value)}
                                className="mt-1"
                            />
                        </div>
                        <Button
                            onClick={handleAddSender}
                            disabled={senderSaving || !newSenderPattern.trim()}
                            className="w-full"
                        >
                            {senderSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                            Add Sender
                        </Button>
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
