'use client';

import { Bell, Bot, CircleHelp, ExternalLink, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/use-notifications';
import type { PendingNotification } from '@/lib/api/notifications';

function formatTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

function getApprovalQuestion(notification: PendingNotification): string {
    const req = notification.approvalRequest as Record<string, unknown> | null;
    if (!req) return 'Action requires your approval';
    if (req.type === 'confirmation' && req.question) return req.question as string;
    return 'Action requires your approval';
}

function NotificationItem({ notification }: { notification: PendingNotification }) {
    const router = useRouter();

    const handleClick = () => {
        router.push(`/agents?agent=${notification.agentId}&session=${notification.sessionId}`);
    };

    return (
        <button
            onClick={handleClick}
            className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-b-0 group"
        >
            <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                    <CircleHelp className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-primary">Approval Needed</span>
                        <span className="text-[10px] text-muted-foreground">{formatTimeAgo(notification.updatedAt)}</span>
                    </div>
                    <p className="text-sm text-foreground line-clamp-2 leading-snug">
                        {getApprovalQuestion(notification)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                        <Bot className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[11px] text-muted-foreground truncate">
                            {notification.agentName}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                    </div>
                </div>
            </div>
        </button>
    );
}

export function NotificationPanel() {
    const { notifications, count } = useNotifications();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9">
                    <Bell className="h-4.5 w-4.5" />
                    {count > 0 && (
                        <Badge
                            variant="destructive"
                            className="absolute -top-1 -right-1 h-4.5 min-w-[18px] flex items-center justify-center p-0 px-1 text-[10px] font-semibold"
                        >
                            {count > 9 ? '9+' : count}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                sideOffset={8}
                className="w-[380px] p-0 overflow-hidden"
            >
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Notifications</h3>
                        {count > 0 && (
                            <Badge variant="secondary" className="text-[10px] h-5">
                                {count} pending
                            </Badge>
                        )}
                    </div>
                </div>
                <ScrollArea className="max-h-[400px]">
                    {notifications.length > 0 ? (
                        notifications.map((n) => (
                            <NotificationItem key={n.id} notification={n} />
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                            <BellOff className="h-8 w-8 text-muted-foreground/40 mb-3" />
                            <p className="text-sm text-muted-foreground">No pending notifications</p>
                            <p className="text-xs text-muted-foreground/60 mt-1">
                                Agent approvals and alerts will appear here
                            </p>
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
