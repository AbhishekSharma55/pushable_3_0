'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { getToken } from '@/lib/auth';
import { getWorkspaces } from '@/lib/api/workspaces';
import { WORKSPACES_KEY, ACTIVE_WORKSPACE_KEY } from '@/lib/constants';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [ready, setReady] = useState(false);

    const isOnboarding = pathname === '/onboarding';

    useEffect(() => {
        const init = async () => {
            const token = getToken();
            if (!token) {
                router.push('/login');
                return;
            }

            try {
                const workspaces = await getWorkspaces();
                localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));

                if (workspaces.length === 0 && !isOnboarding) {
                    router.push('/onboarding');
                    return;
                }

                if (workspaces.length > 0 && isOnboarding) {
                    router.push('/');
                    return;
                }

                // Set first workspace as active if none set
                const active = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
                if (workspaces.length > 0 && !active) {
                    localStorage.setItem(
                        ACTIVE_WORKSPACE_KEY,
                        JSON.stringify(workspaces[0])
                    );
                }

                setReady(true);
            } catch (error) {
                // Token invalid or API error
                router.push('/login');
            }
        };

        init();
    }, [router, isOnboarding]);

    if (!ready) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground">Loading workspace...</p>
                </div>
            </div>
        );
    }

    // No sidebar/topbar for onboarding
    if (isOnboarding) {
        return <main>{children}</main>;
    }

    return (
        <div className="min-h-screen bg-background">
            <Sidebar />
            <div className="pl-64">
                <Topbar />
                <main className="p-6">{children}</main>
            </div>
        </div>
    );
}
