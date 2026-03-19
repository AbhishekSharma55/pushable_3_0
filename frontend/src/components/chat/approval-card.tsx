'use client';

import { motion } from 'framer-motion';
import { CircleHelp, Check, X, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// New format: agent asks a decision question
interface ConfirmationRequest {
    type: 'confirmation';
    question: string;
    context?: string;
}

// Legacy format: tool-level approval (backward compat for in-flight runs)
interface LegacyApprovalRequest {
    toolCalls: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
}

export type ApprovalRequest = ConfirmationRequest | LegacyApprovalRequest;

function isConfirmationRequest(req: ApprovalRequest): req is ConfirmationRequest {
    return 'type' in req && req.type === 'confirmation';
}

interface ApprovalCardProps {
    request: ApprovalRequest;
    onApprove: () => void;
    onReject: () => void;
    disabled?: boolean;
}

function formatArgValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

function formatToolName(name: string): string {
    return name
        .replace(/^system_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ApprovalCard({ request, onApprove, onReject, disabled }: ApprovalCardProps) {
    if (isConfirmationRequest(request)) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="rounded-xl border-2 border-primary/20 bg-card overflow-hidden"
            >
                <div className="bg-primary/5 px-4 py-2.5 flex items-center gap-2 border-b border-primary/10">
                    <CircleHelp className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Confirmation Needed</span>
                </div>
                <div className="p-4 space-y-3">
                    <p className="text-sm text-foreground leading-relaxed">
                        {request.question}
                    </p>
                    {request.context && (
                        <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                {request.context}
                            </p>
                        </div>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                        <Button
                            size="sm"
                            className="gap-1.5 text-xs h-8"
                            disabled={disabled}
                            onClick={onApprove}
                        >
                            <Check className="h-3.5 w-3.5" />
                            Approve
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive"
                            disabled={disabled}
                            onClick={onReject}
                        >
                            <X className="h-3.5 w-3.5" />
                            Reject
                        </Button>
                    </div>
                </div>
            </motion.div>
        );
    }

    // Legacy format: tool-level approval (backward compat)
    return (
        <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="rounded-xl border-2 border-primary/20 bg-card overflow-hidden"
        >
            <div className="bg-primary/5 px-4 py-2.5 flex items-center gap-2 border-b border-primary/10">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Approval Required</span>
            </div>
            <div className="p-4 space-y-3">
                {request.toolCalls.map((atc, i) => (
                    <div key={atc.id || i} className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {formatToolName(atc.name)}
                        </p>
                        <div className="rounded-lg bg-muted/50 border border-border px-3 py-2 space-y-1.5">
                            {Object.entries(atc.args).map(([k, v]) => {
                                const formatted = formatArgValue(v);
                                const isLong = formatted.length > 100;
                                return (
                                    <div key={k} className={cn("text-xs", isLong ? "space-y-1" : "flex gap-2")}>
                                        <span className="font-medium text-muted-foreground min-w-[80px] flex-shrink-0">
                                            {k}:
                                        </span>
                                        <span className={cn(
                                            "text-foreground",
                                            isLong ? "block font-mono text-[11px] whitespace-pre-wrap bg-background rounded px-2 py-1.5 border border-border" : "break-all"
                                        )}>
                                            {formatted}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                    <Button
                        size="sm"
                        className="gap-1.5 text-xs h-8"
                        disabled={disabled}
                        onClick={onApprove}
                    >
                        <Check className="h-3.5 w-3.5" />
                        Approve
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive"
                        disabled={disabled}
                        onClick={onReject}
                    >
                        <X className="h-3.5 w-3.5" />
                        Reject
                    </Button>
                </div>
            </div>
        </motion.div>
    );
}
