'use client';

import { NotificationPanel } from '@/components/notifications/notification-panel';

export function Topbar() {
    return (
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-2 border-b border-border/50 bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <NotificationPanel />
        </header>
    );
}
