'use client';

import { Suspense } from 'react';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { handleIntegrationCallback } from '@/lib/api/integrations';

function CallbackContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();

    // Composio redirects with: ?status=success&connected_account_id=ca_xxx
    const composioStatus = searchParams.get('status');
    const connectedAccountId = searchParams.get('connected_account_id');

    const [pageStatus, setPageStatus] = useState<'processing' | 'active' | 'failed'>('processing');
    const calledRef = useRef(false);

    useEffect(() => {
        if (!workspace || calledRef.current) return;
        if (!connectedAccountId && !composioStatus) return;

        calledRef.current = true;

        const process = async () => {
            try {
                const result = await handleIntegrationCallback(
                    workspace.id,
                    connectedAccountId || '',
                    composioStatus || 'failed'
                );
                setPageStatus(result.status === 'active' ? 'active' : 'failed');
            } catch {
                setPageStatus('failed');
            }
        };

        process();
    }, [workspace, connectedAccountId, composioStatus]);

    // Auto-redirect on success after 2 seconds
    useEffect(() => {
        if (pageStatus !== 'active') return;
        const timeout = setTimeout(() => router.push('/integrations'), 2000);
        return () => clearTimeout(timeout);
    }, [pageStatus, router]);

    if (!connectedAccountId && !composioStatus) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
                <XCircle className="h-12 w-12 text-red-500" />
                <p className="text-lg font-medium">Invalid callback</p>
                <p className="text-sm text-muted-foreground">No connection information received.</p>
                <Button variant="outline" onClick={() => router.push('/integrations')}>
                    Go to Integrations
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
            {pageStatus === 'processing' && (
                <>
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <p className="text-lg font-medium">Connecting your integration...</p>
                    <p className="text-sm text-muted-foreground">
                        Please wait while we verify the connection.
                    </p>
                </>
            )}

            {pageStatus === 'active' && (
                <>
                    <CheckCircle className="h-12 w-12 text-emerald-500" />
                    <p className="text-lg font-medium">Integration connected!</p>
                    <p className="text-sm text-muted-foreground">
                        Your integration is now active and ready to use.
                    </p>
                    <Button onClick={() => router.push('/integrations')}>
                        Go to Integrations
                    </Button>
                </>
            )}

            {pageStatus === 'failed' && (
                <>
                    <XCircle className="h-12 w-12 text-red-500" />
                    <p className="text-lg font-medium">Connection failed.</p>
                    <p className="text-sm text-muted-foreground">
                        Something went wrong while connecting. Please try again.
                    </p>
                    <Button variant="outline" onClick={() => router.push('/integrations')}>
                        Go back
                    </Button>
                </>
            )}
        </div>
    );
}

export default function IntegrationCallbackPage() {
    return (
        <Suspense
            fallback={
                <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <p className="text-lg font-medium">Loading...</p>
                </div>
            }
        >
            <CallbackContent />
        </Suspense>
    );
}
