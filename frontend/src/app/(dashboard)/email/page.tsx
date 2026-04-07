'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Mail,
    Loader2,
    CheckCircle,
    XCircle,
    Clock,
    AlertTriangle,
    ShieldAlert,
    ChevronRight,
    ArrowLeft,
    Check,
    X,
    RefreshCw,
    Settings,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getInbox,
    getEmailDetail,
    approveEmail,
    rejectEmail,
} from '@/lib/api/email';
import type { InboundEmail, EmailStatus, InboxPagination } from '@/lib/api/email';

const STATUS_TABS: { label: string; value: EmailStatus | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Processing', value: 'processing' },
    { label: 'Awaiting Approval', value: 'awaiting_approval' },
    { label: 'Completed', value: 'completed' },
    { label: 'Failed', value: 'failed' },
    { label: 'Spam', value: 'spam' },
];

function statusBadge(status: EmailStatus) {
    const map: Record<EmailStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
        received: { variant: 'secondary', label: 'Received' },
        routing: { variant: 'secondary', label: 'Routing' },
        processing: { variant: 'default', label: 'Processing' },
        awaiting_approval: { variant: 'outline', label: 'Awaiting Approval' },
        approved: { variant: 'default', label: 'Approved' },
        rejected: { variant: 'destructive', label: 'Rejected' },
        completed: { variant: 'default', label: 'Completed' },
        failed: { variant: 'destructive', label: 'Failed' },
        spam: { variant: 'destructive', label: 'Spam' },
    };
    const info = map[status] || { variant: 'secondary' as const, label: status };
    return <Badge variant={info.variant}>{info.label}</Badge>;
}

function statusIcon(status: string) {
    switch (status) {
        case 'received': return <Mail className="h-3.5 w-3.5 text-blue-400" />;
        case 'routing': return <ChevronRight className="h-3.5 w-3.5 text-yellow-400" />;
        case 'processing': return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
        case 'awaiting_approval': return <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />;
        case 'approved': return <Check className="h-3.5 w-3.5 text-green-400" />;
        case 'rejected': return <X className="h-3.5 w-3.5 text-red-400" />;
        case 'completed': return <CheckCircle className="h-3.5 w-3.5 text-green-400" />;
        case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-400" />;
        case 'spam': return <ShieldAlert className="h-3.5 w-3.5 text-red-400" />;
        default: return <Clock className="h-3.5 w-3.5 text-gray-400" />;
    }
}

function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
}

export default function EmailInboxPage() {
    const workspace = useActiveWorkspace();
    const [emails, setEmails] = useState<InboundEmail[]>([]);
    const [pagination, setPagination] = useState<InboxPagination | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<EmailStatus | 'all'>('all');
    const [selectedEmail, setSelectedEmail] = useState<InboundEmail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    const fetchEmails = useCallback(async () => {
        if (!workspace?.id) return;
        setLoading(true);
        try {
            const result = await getInbox(workspace.id, {
                status: activeTab === 'all' ? undefined : activeTab,
                page: 1,
                limit: 50,
            });
            setEmails(result.data);
            setPagination(result.pagination);
        } catch {
            toast.error('Failed to load inbox');
        } finally {
            setLoading(false);
        }
    }, [workspace?.id, activeTab]);

    useEffect(() => { fetchEmails(); }, [fetchEmails]);

    const handleSelectEmail = async (email: InboundEmail) => {
        if (!workspace?.id) return;
        setDetailLoading(true);
        try {
            const detail = await getEmailDetail(workspace.id, email.id);
            setSelectedEmail(detail);
        } catch {
            toast.error('Failed to load email details');
        } finally {
            setDetailLoading(false);
        }
    };

    const handleApprove = async () => {
        if (!workspace?.id || !selectedEmail) return;
        setActionLoading(true);
        try {
            await approveEmail(workspace.id, selectedEmail.id);
            toast.success('Email task approved');
            setSelectedEmail(null);
            fetchEmails();
        } catch {
            toast.error('Failed to approve');
        } finally {
            setActionLoading(false);
        }
    };

    const handleReject = async () => {
        if (!workspace?.id || !selectedEmail) return;
        setActionLoading(true);
        try {
            await rejectEmail(workspace.id, selectedEmail.id);
            toast.success('Email task rejected');
            setSelectedEmail(null);
            fetchEmails();
        } catch {
            toast.error('Failed to reject');
        } finally {
            setActionLoading(false);
        }
    };

    if (!workspace) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <h1 className="text-lg font-semibold">Email Inbox</h1>
                    {pagination && (
                        <span className="text-sm text-muted-foreground">
                            {pagination.total} email{pagination.total !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                <Link href="/email/settings">
                    <Button variant="outline" size="sm">
                        <Settings className="h-4 w-4 mr-1" />
                        Settings
                    </Button>
                </Link>
                <Button variant="outline" size="sm" onClick={fetchEmails} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
                </div>
            </div>

            {/* Status tabs */}
            <div className="flex gap-1 px-6 py-2 border-b border-border overflow-x-auto">
                {STATUS_TABS.map(tab => (
                    <Button
                        key={tab.value}
                        variant={activeTab === tab.value ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => { setActiveTab(tab.value); setSelectedEmail(null); }}
                        className="whitespace-nowrap text-xs"
                    >
                        {tab.label}
                    </Button>
                ))}
            </div>

            {/* Content */}
            <div className="flex flex-1 min-h-0">
                {/* Email list */}
                <div className={`${selectedEmail ? 'w-2/5 border-r border-border' : 'w-full'} flex flex-col`}>
                    <ScrollArea className="flex-1">
                        {loading ? (
                            <div className="p-4 space-y-3">
                                {[...Array(5)].map((_, i) => (
                                    <Skeleton key={i} className="h-16 w-full" />
                                ))}
                            </div>
                        ) : emails.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                <Mail className="h-12 w-12 mb-4 opacity-30" />
                                <p className="text-sm">No emails found</p>
                                <p className="text-xs mt-1">Emails sent to your workspace address will appear here</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-border">
                                {emails.map(email => (
                                    <button
                                        key={email.id}
                                        onClick={() => handleSelectEmail(email)}
                                        className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                                            selectedEmail?.id === email.id ? 'bg-muted/70' : ''
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium truncate">
                                                        {email.fromName || email.fromAddress}
                                                    </span>
                                                    {statusBadge(email.status)}
                                                </div>
                                                <p className="text-sm text-muted-foreground truncate mt-0.5">
                                                    {email.subject || '(no subject)'}
                                                </p>
                                            </div>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                {formatTime(email.createdAt)}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                {/* Email detail panel */}
                {selectedEmail && (
                    <div className="w-3/5 flex flex-col">
                        {detailLoading ? (
                            <div className="flex items-center justify-center flex-1">
                                <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                        ) : (
                            <ScrollArea className="flex-1">
                                <div className="p-6 space-y-6">
                                    {/* Back button (mobile) */}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedEmail(null)}
                                        className="md:hidden mb-2"
                                    >
                                        <ArrowLeft className="h-4 w-4 mr-1" /> Back
                                    </Button>

                                    {/* Email header */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h2 className="text-lg font-semibold">
                                                {selectedEmail.subject || '(no subject)'}
                                            </h2>
                                            {statusBadge(selectedEmail.status)}
                                        </div>
                                        <div className="text-sm text-muted-foreground space-y-1">
                                            <p>
                                                <span className="text-foreground font-medium">From:</span>{' '}
                                                {selectedEmail.fromName
                                                    ? `${selectedEmail.fromName} <${selectedEmail.fromAddress}>`
                                                    : selectedEmail.fromAddress}
                                            </p>
                                            <p>
                                                <span className="text-foreground font-medium">To:</span>{' '}
                                                {selectedEmail.toAddress}
                                            </p>
                                            {selectedEmail.cc && (
                                                <p>
                                                    <span className="text-foreground font-medium">CC:</span>{' '}
                                                    {selectedEmail.cc}
                                                </p>
                                            )}
                                            <p>
                                                <span className="text-foreground font-medium">Date:</span>{' '}
                                                {new Date(selectedEmail.createdAt).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Approval buttons */}
                                    {selectedEmail.status === 'awaiting_approval' && (
                                        <div className="flex gap-3 p-4 rounded-lg border border-orange-500/20 bg-orange-500/5">
                                            <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium">Human approval required</p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    The agent needs your permission to proceed with this task.
                                                </p>
                                                <div className="flex gap-2 mt-3">
                                                    <Button
                                                        size="sm"
                                                        onClick={handleApprove}
                                                        disabled={actionLoading}
                                                    >
                                                        {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                                                        Approve
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        onClick={handleReject}
                                                        disabled={actionLoading}
                                                    >
                                                        <X className="h-4 w-4 mr-1" />
                                                        Reject
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Email body */}
                                    <div className="rounded-lg border border-border p-4">
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-medium">
                                            Email Body
                                        </p>
                                        {selectedEmail.bodyHtml ? (
                                            <div
                                                className="prose prose-sm prose-invert max-w-none"
                                                dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                                            />
                                        ) : (
                                            <pre className="text-sm whitespace-pre-wrap text-foreground">
                                                {selectedEmail.bodyText || '(empty body)'}
                                            </pre>
                                        )}
                                    </div>

                                    {/* Agent reply */}
                                    {selectedEmail.replySent && selectedEmail.replyContent && (
                                        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                                            <p className="text-xs text-green-400 uppercase tracking-wider mb-2 font-medium">
                                                Agent Reply
                                            </p>
                                            <pre className="text-sm whitespace-pre-wrap text-foreground">
                                                {selectedEmail.replyContent}
                                            </pre>
                                        </div>
                                    )}

                                    {/* Error message */}
                                    {selectedEmail.errorMessage && (
                                        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                                            <p className="text-xs text-red-400 uppercase tracking-wider mb-2 font-medium">
                                                Error
                                            </p>
                                            <p className="text-sm text-red-300">
                                                {selectedEmail.errorMessage}
                                            </p>
                                        </div>
                                    )}

                                    {/* Status timeline */}
                                    <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">
                                            Status Timeline
                                        </p>
                                        <div className="space-y-0">
                                            {(selectedEmail.statusHistory as Array<{
                                                status: string;
                                                timestamp: string;
                                                detail: string;
                                            }>).map((entry, i) => (
                                                <div key={i} className="flex gap-3 py-2">
                                                    <div className="flex flex-col items-center">
                                                        {statusIcon(entry.status)}
                                                        {i < (selectedEmail.statusHistory as Array<unknown>).length - 1 && (
                                                            <div className="w-px flex-1 bg-border mt-1" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0 pb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium capitalize">
                                                                {entry.status.replace(/_/g, ' ')}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {formatTime(entry.timestamp)}
                                                            </span>
                                                        </div>
                                                        {entry.detail && (
                                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                                {entry.detail}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
