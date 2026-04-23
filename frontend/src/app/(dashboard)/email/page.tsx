'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Mail,
    Loader2,
    CheckCircle,
    XCircle,
    Clock,
    AlertTriangle,
    Paperclip,
    Download,
    ImageIcon,
    FileText,
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
import type { InboundEmail, EmailStatus, InboxPagination, EmailAttachment } from '@/lib/api/email';
import { apiClient } from '@/lib/api/client';

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

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}

function AttachmentCard({
    attachment,
    workspaceId,
    emailId,
    index,
}: {
    attachment: EmailAttachment;
    workspaceId: string;
    emailId: string;
    index: number;
}) {
    const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [imgLoading, setImgLoading] = useState(false);
    const isImage = isImageType(attachment.mimeType);

    useEffect(() => {
        if (!isImage) return;
        setImgLoading(true);
        apiClient
            .get(`/api/email/inbox/${emailId}/attachment/${index}`, {
                headers: { 'x-workspace-id': workspaceId },
                responseType: 'blob',
            })
            .then(r => {
                const url = URL.createObjectURL(r.data as Blob);
                setImgSrc(url);
            })
            .catch(() => {/* ignore */})
            .finally(() => setImgLoading(false));
    }, [emailId, index, isImage, workspaceId]);

    const handleDownload = async () => {
        try {
            const r = await apiClient.get(`/api/email/inbox/${emailId}/attachment/${index}`, {
                headers: { 'x-workspace-id': workspaceId },
                responseType: 'blob',
            });
            const url = URL.createObjectURL(r.data as Blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = attachment.filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            /* ignore */
        }
    };

    return (
        <div className="border border-border rounded-lg overflow-hidden bg-muted/20 hover:bg-muted/40 transition-colors group">
            {isImage ? (
                <div className="relative">
                    {imgLoading ? (
                        <div className="h-32 flex items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : imgSrc ? (
                        <img
                            src={imgSrc}
                            alt={attachment.filename}
                            className="w-full h-32 object-cover"
                        />
                    ) : (
                        <div className="h-32 flex items-center justify-center">
                            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                    )}
                    <button
                        onClick={handleDownload}
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-md bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <Download className="h-3 w-3 text-white" />
                    </button>
                </div>
            ) : (
                <div className="h-20 flex items-center justify-center">
                    <FileText className="h-8 w-8 text-muted-foreground/40" />
                </div>
            )}
            <div className="px-2.5 py-2 flex items-center justify-between gap-2 border-t border-border">
                <div className="min-w-0">
                    <p className="text-xs font-medium truncate text-foreground">{attachment.filename}</p>
                    <p className="text-[10px] text-muted-foreground">{formatFileSize(attachment.size)}</p>
                </div>
                {!isImage && (
                    <button onClick={handleDownload} className="shrink-0 h-6 w-6 flex items-center justify-center rounded hover:bg-muted">
                        <Download className="h-3 w-3 text-muted-foreground" />
                    </button>
                )}
            </div>
        </div>
    );
}

/** Group emails by sender address, sorted by most recent first within each group */
function groupBySender(emails: InboundEmail[]): { sender: string; emails: InboundEmail[] }[] {
    const map = new Map<string, InboundEmail[]>();
    for (const email of emails) {
        const key = email.fromAddress.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(email);
    }
    // Sort each group newest-first, then sort groups by their latest email
    return Array.from(map.entries())
        .map(([, group]) => ({
            sender: group[0].fromAddress,
            emails: group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        }))
        .sort((a, b) => new Date(b.emails[0].createdAt).getTime() - new Date(a.emails[0].createdAt).getTime());
}

export default function EmailInboxPage() {
    const workspace = useActiveWorkspace();
    const [emails, setEmails] = useState<InboundEmail[]>([]);
    const [pagination, setPagination] = useState<InboxPagination | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<EmailStatus | 'all'>('all');
    // selectedSender: the fromAddress of the selected group
    const [selectedSender, setSelectedSender] = useState<string | null>(null);
    const [detailEmails, setDetailEmails] = useState<InboundEmail[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    // Derived: grouped list for the left panel
    const grouped = groupBySender(emails);
    const selectedGroup = grouped.find(g => g.sender.toLowerCase() === selectedSender?.toLowerCase()) ?? null;

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

    // When a sender group is selected, load full details for all their emails
    const handleSelectSender = async (sender: string, groupEmails: InboundEmail[]) => {
        if (!workspace?.id) return;
        setSelectedSender(sender);
        setDetailEmails(groupEmails); // show immediately with list data
        setDetailLoading(true);
        try {
            const details = await Promise.all(
                groupEmails.map(e => getEmailDetail(workspace.id!, e.id))
            );
            setDetailEmails(details);
        } catch {
            toast.error('Failed to load emails');
        } finally {
            setDetailLoading(false);
        }
    };

    const handleApprove = async (emailId: string) => {
        if (!workspace?.id) return;
        setActionLoading(true);
        try {
            await approveEmail(workspace.id, emailId);
            toast.success('Approved');
            fetchEmails();
        } catch {
            toast.error('Failed to approve');
        } finally {
            setActionLoading(false);
        }
    };

    const handleReject = async (emailId: string) => {
        if (!workspace?.id) return;
        setActionLoading(true);
        try {
            await rejectEmail(workspace.id, emailId);
            toast.success('Rejected');
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
        <div className="flex bg-background overflow-hidden" style={{ height: 'calc(100vh - 80px)', maxHeight: 'calc(100vh - 80px)' }}>
            {/* ── Left: Sender List ── */}
            <div className={`flex flex-col border-r border-border shrink-0 overflow-hidden ${selectedSender ? 'w-[340px]' : 'flex-1 max-w-2xl mx-auto w-full'}`}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">Email Inbox</span>
                        {grouped.length > 0 && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                                {grouped.length}
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

                {/* Sender list */}
                <ScrollArea className="flex-1 min-h-0">
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
                    ) : grouped.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground px-6">
                            <Mail className="h-10 w-10 mb-3 opacity-20" />
                            <p className="text-sm font-medium">No emails</p>
                            <p className="text-xs mt-1 opacity-60">Emails sent to your workspace address will appear here</p>
                        </div>
                    ) : (
                        <div className="py-1">
                            {grouped.map(({ sender, emails: senderEmails }) => {
                                const latest = senderEmails[0];
                                const isSelected = selectedSender?.toLowerCase() === sender.toLowerCase();
                                const preview = cleanBodyText(latest.bodyText).replace(/\s+/g, ' ').slice(0, 80);
                                const initials = getInitials(latest.fromName, latest.fromAddress);
                                const color = avatarColor(latest.fromAddress);
                                // Show the worst/most-notable status among all emails
                                const statusPriority: EmailStatus[] = ['awaiting_approval', 'failed', 'spam', 'processing', 'routing', 'received', 'approved', 'rejected', 'completed'];
                                const topStatus = statusPriority.find(s => senderEmails.some(e => e.status === s)) ?? latest.status;

                                return (
                                    <button
                                        key={sender}
                                        onClick={() => handleSelectSender(sender, senderEmails)}
                                        className={`w-full text-left px-3 py-3 transition-colors hover:bg-muted/50 ${
                                            isSelected ? 'bg-muted border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'
                                        }`}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            <div className="relative shrink-0">
                                                <div className={`h-8 w-8 rounded-full ${color} flex items-center justify-center text-white text-xs font-bold`}>
                                                    {initials}
                                                </div>
                                                {senderEmails.length > 1 && (
                                                    <span className="absolute -bottom-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                                                        {senderEmails.length}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                                    <span className="text-sm font-semibold truncate text-foreground">
                                                        {latest.fromName || latest.fromAddress}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground shrink-0">
                                                        {formatTime(latest.createdAt)}
                                                    </span>
                                                </div>
                                                <p className="text-xs font-medium text-foreground/80 truncate mb-1">
                                                    {latest.subject || '(no subject)'}
                                                </p>
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="text-[11px] text-muted-foreground truncate">
                                                        {preview || 'No preview available'}
                                                    </p>
                                                    <StatusBadge status={topStatus} />
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

            {/* ── Right: Thread view (all emails from selected sender) ── */}
            {selectedSender ? (
                <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 h-12 border-b border-border shrink-0">
                        <button
                            onClick={() => { setSelectedSender(null); setDetailEmails([]); }}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back
                        </button>
                        <div className="flex items-center gap-2">
                            {selectedGroup && (
                                <span className="text-xs text-muted-foreground">
                                    {selectedGroup.emails[0]?.fromName || selectedGroup.sender} · {detailEmails.length} email{detailEmails.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                    </div>

                    {detailLoading && detailEmails.length === 0 ? (
                        <div className="p-6 space-y-4">
                            <Skeleton className="h-5 w-2/3" />
                            <Skeleton className="h-32 w-full" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ) : (
                        <ScrollArea className="flex-1 min-h-0">
                            <div className="max-w-2xl mx-auto px-6 py-5 space-y-4">
                                {detailEmails.map((email) => (
                                    <EmailCard
                                        key={email.id}
                                        email={email}
                                        onApprove={() => handleApprove(email.id)}
                                        onReject={() => handleReject(email.id)}
                                        actionLoading={actionLoading}
                                    />
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                    <Mail className="h-12 w-12 mb-3 opacity-10" />
                    <p className="text-sm text-muted-foreground/60">Select a sender to read their emails</p>
                </div>
            )}
        </div>
    );
}

// ── Single email card used in the thread view ────────────────────────────────

function EmailCard({
    email,
    onApprove,
    onReject,
    actionLoading,
}: {
    email: InboundEmail;
    onApprove: () => void;
    onReject: () => void;
    actionLoading: boolean;
}) {
    const [expanded, setExpanded] = useState(true);
    const body = cleanBodyText(email.bodyText);

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Card header — always visible, click to collapse */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
            >
                <div className={`h-8 w-8 rounded-full ${avatarColor(email.fromAddress)} flex items-center justify-center shrink-0 text-white text-xs font-bold mt-0.5`}>
                    {getInitials(email.fromName, email.fromAddress)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold truncate">
                            {email.subject || '(no subject)'}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                            <StatusBadge status={email.status} />
                            <span className="text-[11px] text-muted-foreground">{formatTime(email.createdAt)}</span>
                        </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 space-y-0">
                        <p><span className="opacity-60">To:</span> {email.toAddress}</p>
                        {email.cc && <p><span className="opacity-60">CC:</span> {email.cc}</p>}
                        {email.bcc && <p><span className="opacity-60">BCC:</span> {email.bcc}</p>}
                    </div>
                </div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>

            {expanded && (
                <div className="border-t border-border space-y-0">
                    {/* Approval banner */}
                    {email.status === 'awaiting_approval' && (
                        <div className="flex items-start gap-2.5 px-4 py-3 bg-orange-500/5 border-b border-orange-500/20">
                            <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-xs font-semibold text-orange-300">Approval Required</p>
                                <p className="text-xs text-muted-foreground mt-0.5">The AI agent needs your permission to proceed.</p>
                                <div className="flex gap-2 mt-2">
                                    <Button size="sm" onClick={onApprove} disabled={actionLoading}
                                        className="bg-green-600 hover:bg-green-700 text-white h-7 px-3 text-xs">
                                        {actionLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                                        Approve
                                    </Button>
                                    <Button size="sm" variant="destructive" onClick={onReject} disabled={actionLoading}
                                        className="h-7 px-3 text-xs">
                                        <X className="h-3 w-3 mr-1" />Reject
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Body */}
                    <div className="px-4 py-3">
                        {email.bodyHtml ? (
                            <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed"
                                dangerouslySetInnerHTML={{ __html: email.bodyHtml }} />
                        ) : body ? (
                            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{body}</p>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">(empty body)</p>
                        )}
                    </div>

                    {/* Attachments */}
                    {email.attachments?.length > 0 && (
                        <div className="border-t border-border px-4 py-3">
                            <div className="flex items-center gap-1.5 mb-2">
                                <Paperclip className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs font-medium text-muted-foreground">{email.attachments.length} attachment{email.attachments.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {email.attachments.map((att, i) => (
                                    <AttachmentCard key={i} attachment={att} workspaceId={email.workspaceId} emailId={email.id} index={i} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Agent response */}
                    {email.replyContent && (
                        <div className="border-t border-green-500/20 bg-green-500/5 px-4 py-3">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Bot className="h-3 w-3 text-green-400" />
                                <span className="text-xs font-medium text-green-400">Agent Response</span>
                            </div>
                            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{email.replyContent}</p>
                        </div>
                    )}

                    {/* Error */}
                    {email.errorMessage && (
                        <div className="border-t border-red-500/20 bg-red-500/5 px-4 py-3">
                            <p className="text-xs text-red-400 font-medium mb-1">Error</p>
                            <p className="text-xs text-red-300">{email.errorMessage}</p>
                        </div>
                    )}

                    {/* Timeline */}
                    {(email.statusHistory as Array<unknown>)?.length > 0 && (
                        <div className="border-t border-border px-4 py-3">
                            <div className="flex items-center gap-1.5 mb-2">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Timeline</span>
                            </div>
                            {(email.statusHistory as Array<{ status: string; timestamp: string; detail: string }>).map((entry, i, arr) => (
                                <div key={i} className="flex gap-2.5">
                                    <div className="flex flex-col items-center">
                                        <div className="h-5 w-5 rounded-full bg-muted/60 border border-border flex items-center justify-center shrink-0">
                                            <TimelineIcon status={entry.status} />
                                        </div>
                                        {i < arr.length - 1 && <div className="w-px flex-1 bg-border/60 my-0.5 min-h-[8px]" />}
                                    </div>
                                    <div className={`flex-1 min-w-0 ${i < arr.length - 1 ? 'pb-2.5' : 'pb-0'}`}>
                                        <div className="flex items-baseline gap-1.5 mt-0.5">
                                            <span className="text-xs font-semibold capitalize">{entry.status.replace(/_/g, ' ')}</span>
                                            <span className="text-[10px] text-muted-foreground">{formatTime(entry.timestamp)}</span>
                                        </div>
                                        {entry.detail && <p className="text-[11px] text-muted-foreground mt-0.5">{entry.detail}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
