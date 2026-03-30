'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Zap, Loader2 } from 'lucide-react';
import { compileWorkflow } from '@/lib/api/workflows';

interface SaveAsWorkflowButtonProps {
    sessionId: string | null;
    agentId: string | null;
    workspaceId: string | undefined;
}

export function SaveAsWorkflowButton({
    sessionId,
    agentId,
    workspaceId,
}: SaveAsWorkflowButtonProps) {
    const [loading, setLoading] = useState(false);

    const disabled = !sessionId || !agentId || !workspaceId;

    const handleClick = async () => {
        if (!sessionId || !agentId || !workspaceId) return;

        setLoading(true);
        try {
            const workflow = await compileWorkflow(workspaceId, sessionId, agentId);
            toast.success(`Workflow "${workflow.name}" created`);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(
                error.response?.data?.error?.message || 'Failed to compile workflow',
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            disabled={disabled || loading}
            onClick={handleClick}
        >
            {loading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
                <Zap className="h-4 w-4 mr-1.5" />
            )}
            Save as Workflow
        </Button>
    );
}
