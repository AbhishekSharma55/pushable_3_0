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
    Check,
    X,
    RefreshCw,
    Settings,
    Bot,
    ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
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

type StatusCfg = { dot: string; label: string; badge: string };
const STATUS_CONFIG: Record<EmailStatus, StatusCfg> = {
    received:          { dot: 'bg-blue-400',   label: 'Received',          badge: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
    routing:           { dot: 'bg-yellow-400', label: 'Routing',           badge: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
    processing:        { dot: 'bg-blue-400',   label: 'Processing',        badge: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
    awaiting_approval: { dot: 'bg-orange-400', label: 'Needs Approval',    badge: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
    approved:          { dot: 'bg-green-400',  label: 'Approved',          badge: 'text-green-400 bg-green-400/10 border-green-400/20' },
    rejected:          { dot: 'bg-red-400',    label: 'Rejected',          badge: 'text-red-400 bg-red-400/10 border-red-400/20' },
    completed:         { dot: 'bg-green-400',  label: 'Completed',         badge: 'text-green-400 bg-green-400/10 border-green-400/20' },
    failed:            { dot: 'bg-red-400',    label: 'Failed',            badge: 'text-red-400 bg-red-400/10 border-red-400/20' },
    spam:              { dot: 'bg-zinc-400',   label: 'Spam',              badge: 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20' },
};

function StatusBadge({ status }: { status: EmailStatus }) {
    const cfg = STATUS_CONFIG[status] ?? { dot: 'bg-muted', label: status, badge: 'text-muted-foreground bg-muted border-border' };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
        </span>
    );
}

function TimelineIcon({ status }: { status: string }) {
    const cls = "h-3 w-3";
    switch (status) {
        case 'received':          return <Mail className={`${cls} text-blue-400`} />;
        case 'routing':           return <ChevronRight className={`${cls} text-yellow-400`} />;
        case 'processing':        return <Loader2 className={`${cls} text-blue-400`} />;
        case 'awaiting_approval': return <AlertTriangle className={`${cls} text-orange-400`} />;
        case 'approved':          return <Check className={`${cls} text-green-400`} />;
        case 'rejected':          return <X className={`${cls} text-red-400`} />;
        case 'completed':         return <CheckCircle className={`${cls} text-green-400`} />;
        case 'failed':            return <XCircle className={`${cls} text-red-400`} />;
        case 'spam':              return <ShieldAlert className={`${cls} text-zinc-400`} />;
        default:                  return <Clock className={`${cls} text-muted-foreground`} />;
    }
}

function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr: string) {
    return new Date(dateStr).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function getInitials(name: string | null, email: string): string {
    if (name) {
        const parts = name.trim().split(' ');
        return parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : name.slice(0, 2).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
    'bg-rose-500', 'bg-amber-500', 'bg-cyan-500', 'bg-pink-500',
];
function avatarColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Strip any residual email header lines from the start of body text */
function cleanBodyText(text: string | null): string {
    if (!text) return '';
    // Remove leading lines that look like RFC 2822 / MIME headers
    const lines = text.split('\n');
    let start = 0;
    const headerRe = /^[A-Za-z-]{2,}:\s/;
    while (start < lines.length && (headerRe.test(lines[start]) || lines[start].trim() === '')) {
        start++;
    }
    return lines.slice(start).join('\n').trim();
}

export default function EmailInboxPage() {
    const workspace = useActiveWorkspace();
    const [emails, setEmails] = useState<InboundEmail[]>([]);
    const [pagination, setPagination] = useState<InboxPagination | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<EmailStatus | 'all'>('all');
    const [selected, setSelected] = useState<InboundEmail | null>(null);
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

    const handleSelect = async (email: InboundEmail) => {
        if (!workspace?.id) return;
        setSelected(email);
        setDetailLoading(true);
        try {
            const detail = await getEmailDetail(workspace.id, email.id);
            setSelected(detail);
        } catch {
            toast.error('Failed to load email');
        } finally {
            setDetailLoading(false);
        }
    };

    const handleApprove = async () => {
        if (!workspace?.id || !selected) return;
        setActionLoading(true);
        try {
            await approveEmail(workspace.id, selected.id);
            toast.success('Approved');
            setSelected(null);
            fetchEmails();
        } catch {
            toast.error('Failed to approve');
        } finally {
            setActionLoading(false);
        }
    };

    const handleReject = async () => {
        if (!workspace?.id || !selected) return;
        setActionLoading(true);
        try {
            await rejectEmail(workspace.id, selected.id);
            toast.success('Rejected');
            setSelected(null);
            fetchEmails();
        } catch {
            toast.error('Failed to reject');
        } finally {
            setActionLoading(false);
        }
    };

    if (!workspace) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-5 w-5 animate-spin" /></div>;
    }

    return (
        <div className="flex h-full bg-background overflow-hidden">
            {/* ── Left: Email List ── */}
            <div className={`flex flex-col border-r border-border shrink-0 ${selected ? 'w-[340px]' : 'flex-1 max-w-2xl mx-auto w-full'}`}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">Email Inbox</span>
                        {pagination && pagination.total > 0 && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                                {pagination.total}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={fetchEmails} disabled={loading} className="h-7 w-7">
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Link href="/email/settings">
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                                <Settings className="h-3.5 w-3.5" />
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-0.5 px-3 py-2 border-b border-border overflow-x-auto scrollbar-hide shrink-0">
                    {STATUS_TABS.map(tab => (
                        <button
                            key={tab.value}
                            onClick={() => { setActiveTab(tab.value); setSelected(null); }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                                activeTab === tab.value
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* List */}
                <ScrollArea className="flex-1">
                    {loading ? (
                        <div className="p-3 space-y-1">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="flex items-start gap-3 px-3 py-3">
                                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <Skeleton className="h-3 w-1/2" />
                                        <Skeleton className="h-3 w-3/4" />
                                        <Skeleton className="h-3 w-1/3" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : emails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground px-6">
                            <Mail className="h-10 w-10 mb-3 opacity-20" />
                            <p className="text-sm font-medium">No emails</p>
                            <p className="text-xs mt-1 opacity-60">Emails sent to your workspace address will appear here</p>
                        </div>
                    ) : (
                        <div className="py-1">
                            {emails.map(email => {
                                const isSelected = selected?.id === email.id;
                                const preview = cleanBodyText(email.bodyText).replace(/\s+/g, ' ').slice(0, 90);
                                const initials = getInitials(email.fromName, email.fromAddress);
                                const color = avatarColor(email.fromAddress);

                                return (
                                    <button
                                        key={email.id}
                                        onClick={() => handleSelect(email)}
                                        className={`w-full text-left px-3 py-3 transition-colors hover:bg-muted/50 ${
                                            isSelected ? 'bg-muted border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'
                                        }`}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <div className={`h-8 w-8 rounded-full ${color} flex items-center justify-center shrink-0 text-white text-xs font-bold mt-0.5`}>
                                                {initials}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                    <span className="text-sm font-semibold truncate text-foreground">
                                                        {email.fromName || email.fromAddress}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground shrink-0">
                                                        {formatTime(email.createdAt)}
                                                    </span>
                                                </div>
                                                <p className="text-xs font-medium text-foreground/80 truncate mb-1">
                                                    {email.subject || '(no subject)'}
                                                </p>
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-[11px] text-muted-foreground truncate">
                                                        {preview || 'No preview available'}
                                                    </p>
                                                    <StatusBadge status={email.status} />
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>
            </div>

            {/* ── Right: Detail ── */}
            {selected ? (
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {detailLoading ? (
                        <div className="p-6 space-y-4">
                            <Skeleton className="h-5 w-2/3" />
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ) : (
                        <>
                            {/* Detail header */}
                            <div className="flex items-center justify-between px-5 h-12 border-b border-border shrink-0">
                                <button
                                    onClick={() => setSelected(null)}
                                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                    Back
                                </button>
                                <StatusBadge status={selected.status} />
                            </div>

                            <ScrollArea className="flex-1">
                                <div className="max-w-2xl mx-auto px-6 py-5 space-y-5">
                                    {/* Subject + sender */}
                                    <div>
                                        <h2 className="text-lg font-semibold leading-snug mb-3">
                                            {selected.subject || '(no subject)'}
                                        </h2>
                                        <div className="flex items-center gap-2.5">
                                            <div className={`h-9 w-9 rounded-full ${avatarColor(selected.fromAddress)} flex items-center justify-center shrink-0 text-white text-xs font-bold`}>
                                                {getInitials(selected.fromName, selected.fromAddress)}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-sm font-semibold">
                                                        {selected.fromName || selected.fromAddress}
                                                    </span>
                                                    {selected.fromName && (
                                                        <span className="text-xs text-muted-foreground">
                                                            &lt;{selected.fromAddress}&gt;
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    To: {selected.toAddress}
                                                    {selected.cc && ` · CC: ${selected.cc}`}
                                                    {' · '}{formatFullDate(selected.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Approval banner */}
                                    {selected.status === 'awaiting_approval' && (
                                        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
                                            <div className="flex items-start gap-2.5">
                                                <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                                                <div className="flex-1">
                                                    <p className="text-sm font-semibold text-orange-300">Approval Required</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        The AI agent wants to take an action and needs your permission to proceed.
                                                    </p>
                                                    <div className="flex gap-2 mt-3">
                                                        <Button
                                                            size="sm"
                                                            onClick={handleApprove}
                                                            disabled={actionLoading}
                                                            className="bg-green-600 hover:bg-green-700 text-white h-8 px-4 text-xs"
                                                        >
                                                            {actionLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Check className="h-3 w-3 mr-1.5" />}
                                                            Approve
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={handleReject}
                                                            disabled={actionLoading}
                                                            className="h-8 px-4 text-xs"
                                                        >
                                                            <X className="h-3 w-3 mr-1.5" />
                                                            Reject
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Email body */}
                                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                                        <div className="px-4 py-2.5 border-b border-border bg-muted/30">
                                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</span>
                                        </div>
                                        <div className="p-4">
                                            {(() => {
                                                const body = cleanBodyText(selected.bodyText);
                                                if (!body && !selected.bodyHtml) return (
                                                    <p className="text-sm text-muted-foreground italic">(empty body)</p>
                                                );
                                                if (selected.bodyHtml) return (
                                                    <div
                                                        className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed"
                                                        dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
                                                    />
                                                );
                                                return (
                                                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                                                        {body}
                                                    </p>
                                                );
                                            })()}
                                        </div>
                                    </div>

                                    {/* Agent response */}
                                    {selected.replyContent && (
                                        <div className="rounded-xl border border-green-500/20 bg-green-500/5 overflow-hidden">
                                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-green-500/20 bg-green-500/5">
                                                <Bot className="h-3.5 w-3.5 text-green-400" />
                                                <span className="text-xs font-medium text-green-400 uppercase tracking-wide">Agent Response</span>
                                            </div>
                                            <div className="p-4">
                                                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                                                    {selected.replyContent}
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Error */}
                                    {selected.errorMessage && (
                                        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                                            <p className="text-xs text-red-400 uppercase tracking-wide mb-1.5 font-medium">Error</p>
                                            <p className="text-sm text-red-300">{selected.errorMessage}</p>
                                        </div>
                                    )}

                                    {/* Timeline */}
                                    {selected.statusHistory && (selected.statusHistory as Array<unknown>).length > 0 && (
                                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
                                                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Timeline</span>
                                            </div>
                                            <div className="px-4 py-3">
                                                {(selected.statusHistory as Array<{
                                                    status: string;
                                                    timestamp: string;
                                                    detail: string;
                                                }>).map((entry, i, arr) => (
                                                    <div key={i} className="flex gap-3">
                                                        <div className="flex flex-col items-center">
                                                            <div className="h-6 w-6 rounded-full bg-muted/60 border border-border flex items-center justify-center shrink-0">
                                                                <TimelineIcon status={entry.status} />
                                                            </div>
                                                            {i < arr.length - 1 && (
                                                                <div className="w-px flex-1 bg-border/60 my-1 min-h-[12px]" />
                                                            )}
                                                        </div>
                                                        <div className={`flex-1 min-w-0 ${i < arr.length - 1 ? 'pb-3' : 'pb-0'}`}>
                                                            <div className="flex items-baseline gap-2 mt-0.5">
                                                                <span className="text-xs font-semibold text-foreground capitalize">
                                                                    {entry.status.replace(/_/g, ' ')}
                                                                </span>
                                                                <span className="text-[11px] text-muted-foreground">
                                                                    {formatTime(entry.timestamp)}
                                                                </span>
                                                            </div>
                                                            {entry.detail && (
                                                                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                                                                    {entry.detail}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </>
                    )}
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <Mail className="h-12 w-12 mb-3 opacity-10" />
                    <p className="text-sm text-muted-foreground/60">Select an email to read</p>
                </div>
            )}
        </div>
    );
}
