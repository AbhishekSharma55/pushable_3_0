'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { runWorkflow } from '@/lib/api/workflows';
import type { Workflow, WorkflowRun } from '@/types';

interface RunWorkflowDialogProps {
    workflow: Workflow;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    onSuccess: () => void;
}

function formatDuration(ms: number | null): string {
    if (ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m ${remaining}s`;
}

export function RunWorkflowDialog({
    workflow,
    open,
    onOpenChange,
    workspaceId,
    onSuccess,
}: RunWorkflowDialogProps) {
    const paramEntries = Object.entries(workflow.inputSchema);

    const buildDefaults = useCallback((): Record<string, unknown> => {
        const defaults: Record<string, unknown> = {};
        for (const [key, param] of Object.entries(workflow.inputSchema)) {
            if (param.default !== undefined) {
                defaults[key] = param.default;
            } else if (param.type === 'boolean') {
                defaults[key] = false;
            } else if (param.type === 'number') {
                defaults[key] = '';
            } else {
                defaults[key] = '';
            }
        }
        return defaults;
    }, [workflow.inputSchema]);

    const [inputData, setInputData] = useState<Record<string, unknown>>(buildDefaults);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<WorkflowRun | null>(null);

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setInputData(buildDefaults());
            setResult(null);
            setRunning(false);
        }
        onOpenChange(nextOpen);
    };

    const updateInput = useCallback((key: string, value: unknown) => {
        setInputData((prev) => ({ ...prev, [key]: value }));
    }, []);

    const validate = (): boolean => {
        for (const [key, param] of Object.entries(workflow.inputSchema)) {
            if (param.required) {
                const val = inputData[key];
                if (val === undefined || val === null || val === '') {
                    toast.error(`"${key}" is required`);
                    return false;
                }
            }
        }
        return true;
    };

    const handleRun = async () => {
        if (!validate()) return;

        // Coerce types before sending
        const coerced: Record<string, unknown> = {};
        for (const [key, param] of Object.entries(workflow.inputSchema)) {
            const raw = inputData[key];
            if (raw === undefined || raw === '') continue;
            if (param.type === 'number') {
                coerced[key] = Number(raw);
            } else if (param.type === 'boolean') {
                coerced[key] = Boolean(raw);
            } else {
                coerced[key] = String(raw);
            }
        }

        setRunning(true);
        setResult(null);
        try {
            const run = await runWorkflow(workspaceId, workflow.id, coerced);
            setResult(run);
            onSuccess();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Failed to run workflow');
        } finally {
            setRunning(false);
        }
    };

    const handleRunAgain = () => {
        setResult(null);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Run Workflow: {workflow.name}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Run the workflow with input parameters.
                    </DialogDescription>
                </DialogHeader>

                {!result ? (
                    <>
                        <div className="space-y-4">
                            {paramEntries.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">
                                    This workflow has no input parameters. Click run to execute it.
                                </p>
                            )}

                            {paramEntries.map(([key, param]) => (
                                <div key={key} className="space-y-1.5">
                                    <Label className="text-sm">
                                        {key}
                                        {param.required && (
                                            <span className="text-destructive ml-0.5">*</span>
                                        )}
                                    </Label>
                                    {param.description && (
                                        <p className="text-[11px] text-muted-foreground">
                                            {param.description}
                                        </p>
                                    )}

                                    {param.type === 'boolean' ? (
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={Boolean(inputData[key])}
                                                onCheckedChange={(v) => updateInput(key, v)}
                                            />
                                            <span className="text-sm text-muted-foreground">
                                                {inputData[key] ? 'True' : 'False'}
                                            </span>
                                        </div>
                                    ) : param.type === 'number' ? (
                                        <Input
                                            type="number"
                                            value={String(inputData[key] ?? '')}
                                            onChange={(e) => updateInput(key, e.target.value)}
                                            placeholder={`Enter ${key}`}
                                        />
                                    ) : (
                                        <Input
                                            value={String(inputData[key] ?? '')}
                                            onChange={(e) => updateInput(key, e.target.value)}
                                            placeholder={`Enter ${key}`}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => handleOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button disabled={running} onClick={handleRun}>
                                {running ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Running...
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4 mr-2" />
                                        Run
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <div className="space-y-4">
                            {/* Status */}
                            <div className="flex items-center gap-3">
                                {result.status === 'completed' ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                    <XCircle className="h-5 w-5 text-destructive" />
                                )}
                                <Badge
                                    variant={
                                        result.status === 'completed'
                                            ? 'default'
                                            : 'destructive'
                                    }
                                >
                                    {result.status}
                                </Badge>
                            </div>

                            {/* Metrics */}
                            <div className="flex gap-4 text-sm">
                                <div>
                                    <span className="text-muted-foreground">Duration: </span>
                                    <span className="font-medium">
                                        {formatDuration(result.durationMs)}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Credits: </span>
                                    <span className="font-medium">{result.creditsUsed}</span>
                                </div>
                            </div>

                            {/* Result text */}
                            {result.resultText && (
                                <div className="space-y-1.5">
                                    <Label className="text-sm text-muted-foreground">Result</Label>
                                    <div className="rounded-lg border bg-muted/30 p-3 max-h-60 overflow-y-auto">
                                        <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                                            <code>{result.resultText}</code>
                                        </pre>
                                    </div>
                                </div>
                            )}

                            {/* Error */}
                            {result.error && (
                                <div className="space-y-1.5">
                                    <Label className="text-sm text-destructive">Error</Label>
                                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 max-h-40 overflow-y-auto">
                                        <pre className="text-xs whitespace-pre-wrap break-words font-mono text-destructive">
                                            <code>{result.error}</code>
                                        </pre>
                                    </div>
                                </div>
                            )}
                        </div>

                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => handleOpenChange(false)}
                            >
                                Close
                            </Button>
                            <Button onClick={handleRunAgain}>
                                <Play className="h-4 w-4 mr-2" />
                                Run Again
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
