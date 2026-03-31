'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Loader2,
    Plus,
    Trash2,
    ChevronUp,
    ChevronDown,
    Wrench,
    Brain,
} from 'lucide-react';
import { createWorkflow, updateWorkflow } from '@/lib/api/workflows';
import { getAgents } from '@/lib/api/agents';
import type { Workflow, Agent, WorkflowStep } from '@/types';

interface InputParamDraft {
    id: string;
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
}

interface StepDraft {
    id: string;
    type: 'tool' | 'nano_llm';
    tool: string;
    prompt: string;
    args: { key: string; value: string }[];
    outputKey: string;
}

interface CreateWorkflowSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    workflow?: Workflow | null;
    onSuccess: () => void;
}

function generateId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function stepsFromRecipe(steps: WorkflowStep[]): StepDraft[] {
    return steps.map((s) => ({
        id: s.id,
        type: s.type,
        tool: s.tool ?? '',
        prompt: s.prompt ?? '',
        args: s.args
            ? Object.entries(s.args).map(([key, value]) => ({
                  key,
                  value: String(value),
              }))
            : [],
        outputKey: s.outputKey,
    }));
}

function paramsFromSchema(
    schema: Record<string, { type: 'string' | 'number' | 'boolean'; description: string; required?: boolean }>,
): InputParamDraft[] {
    return Object.entries(schema).map(([name, param]) => ({
        id: generateId(),
        name,
        type: param.type,
        description: param.description,
        required: param.required ?? false,
    }));
}

export function CreateWorkflowSheet({
    open,
    onOpenChange,
    workspaceId,
    workflow,
    onSuccess,
}: CreateWorkflowSheetProps) {
    const isEdit = !!workflow;
    const isCompiled = !!workflow?.sourceSessionId;

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [agentId, setAgentId] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [agents, setAgents] = useState<Agent[]>([]);

    const [steps, setSteps] = useState<StepDraft[]>([]);
    const [inputParams, setInputParams] = useState<InputParamDraft[]>([]);

    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        getAgents(workspaceId).then(setAgents).catch(() => {});
    }, [open, workspaceId]);

    useEffect(() => {
        if (!open) return;
        if (isEdit && workflow) {
            setName(workflow.name);
            setDescription(workflow.description ?? '');
            setAgentId(workflow.agentId);
            setEnabled(workflow.enabled);
            setSteps(stepsFromRecipe(workflow.recipe.steps));
            setInputParams(paramsFromSchema(workflow.inputSchema));
        } else {
            setName('');
            setDescription('');
            setAgentId('');
            setEnabled(true);
            setSteps([]);
            setInputParams([]);
        }
    }, [open, workflow, isEdit]);

    // --- Step management ---
    const addStep = useCallback((type: 'tool' | 'nano_llm') => {
        setSteps((prev) => [
            ...prev,
            {
                id: generateId(),
                type,
                tool: '',
                prompt: '',
                args: [],
                outputKey: `step_${prev.length + 1}`,
            },
        ]);
    }, []);

    const removeStep = useCallback((id: string) => {
        setSteps((prev) => prev.filter((s) => s.id !== id));
    }, []);

    const moveStep = useCallback((id: string, direction: 'up' | 'down') => {
        setSteps((prev) => {
            const idx = prev.findIndex((s) => s.id === id);
            if (idx === -1) return prev;
            const target = direction === 'up' ? idx - 1 : idx + 1;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[target]] = [next[target], next[idx]];
            return next;
        });
    }, []);

    const updateStep = useCallback((id: string, updates: Partial<StepDraft>) => {
        setSteps((prev) =>
            prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
        );
    }, []);

    const addStepArg = useCallback((stepId: string) => {
        setSteps((prev) =>
            prev.map((s) =>
                s.id === stepId
                    ? { ...s, args: [...s.args, { key: '', value: '' }] }
                    : s,
            ),
        );
    }, []);

    const updateStepArg = useCallback(
        (stepId: string, argIdx: number, field: 'key' | 'value', val: string) => {
            setSteps((prev) =>
                prev.map((s) => {
                    if (s.id !== stepId) return s;
                    const args = [...s.args];
                    args[argIdx] = { ...args[argIdx], [field]: val };
                    return { ...s, args };
                }),
            );
        },
        [],
    );

    const removeStepArg = useCallback((stepId: string, argIdx: number) => {
        setSteps((prev) =>
            prev.map((s) => {
                if (s.id !== stepId) return s;
                const args = s.args.filter((_, i) => i !== argIdx);
                return { ...s, args };
            }),
        );
    }, []);

    // --- Input params management ---
    const addInputParam = useCallback(() => {
        setInputParams((prev) => [
            ...prev,
            {
                id: generateId(),
                name: '',
                type: 'string',
                description: '',
                required: false,
            },
        ]);
    }, []);

    const updateInputParam = useCallback(
        (id: string, updates: Partial<InputParamDraft>) => {
            setInputParams((prev) =>
                prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
            );
        },
        [],
    );

    const removeInputParam = useCallback((id: string) => {
        setInputParams((prev) => prev.filter((p) => p.id !== id));
    }, []);

    // --- Submit ---
    const handleSubmit = async () => {
        if (!name.trim()) {
            toast.error('Name is required');
            return;
        }
        if (!agentId) {
            toast.error('Please select an agent');
            return;
        }

        const inputSchema: Record<
            string,
            { type: 'string' | 'number' | 'boolean'; description: string; required?: boolean }
        > = {};
        for (const p of inputParams) {
            if (!p.name.trim()) continue;
            inputSchema[p.name.trim()] = {
                type: p.type,
                description: p.description,
                required: p.required || undefined,
            };
        }

        const recipeSteps: WorkflowStep[] = steps.map((s) => {
            const step: WorkflowStep = {
                id: s.id,
                type: s.type,
                outputKey: s.outputKey,
            };
            if (s.type === 'tool') {
                step.tool = s.tool;
                if (s.args.length > 0) {
                    const args: Record<string, unknown> = {};
                    for (const a of s.args) {
                        if (a.key.trim()) args[a.key.trim()] = a.value;
                    }
                    if (Object.keys(args).length > 0) step.args = args;
                }
            } else {
                step.prompt = s.prompt;
            }
            return step;
        });

        setSubmitting(true);
        try {
            if (isEdit && workflow) {
                await updateWorkflow(workspaceId, workflow.id, {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    enabled,
                    inputSchema,
                    ...(isCompiled
                        ? {}
                        : { recipe: { version: 1, steps: recipeSteps } }),
                });
                toast.success('Workflow updated');
            } else {
                await createWorkflow(workspaceId, {
                    agentId,
                    name: name.trim(),
                    description: description.trim() || undefined,
                    enabled,
                    inputSchema,
                    recipe: { version: 1, steps: recipeSteps },
                });
                toast.success('Workflow created');
            }
            onOpenChange(false);
            onSuccess();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Something went wrong');
        } finally {
            setSubmitting(false);
        }
    };

    const canSubmit = name.trim() && agentId;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Workflow' : 'Create Workflow'}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {isEdit ? 'Update your workflow.' : 'Create a new workflow.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    {/* Compiled badge */}
                    {isCompiled && (
                        <Badge variant="secondary">Compiled from session</Badge>
                    )}

                    {/* Name */}
                    <div className="space-y-1.5">
                        <Label className="text-sm text-muted-foreground">Name</Label>
                        <Input
                            placeholder="e.g. Weekly report generator"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                        <Label className="text-sm text-muted-foreground">
                            Description <span className="text-muted-foreground/60">(optional)</span>
                        </Label>
                        <Textarea
                            placeholder="What does this workflow do?"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            className="resize-none"
                        />
                    </div>

                    {/* Agent selector */}
                    <div className="space-y-1.5">
                        <Label className="text-sm text-muted-foreground">Agent</Label>
                        <Select
                            value={agentId}
                            onValueChange={setAgentId}
                            disabled={isEdit}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select an agent" />
                            </SelectTrigger>
                            <SelectContent>
                                {agents.map((agent) => (
                                    <SelectItem key={agent.id} value={agent.id}>
                                        {agent.emoji ? `${agent.emoji} ` : ''}{agent.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {isEdit && (
                            <p className="text-[11px] text-muted-foreground">
                                Agent cannot be changed after creation.
                            </p>
                        )}
                    </div>

                    {/* Enable/disable */}
                    <div className="flex items-center justify-between">
                        <div>
                            <Label className="text-sm">Enabled</Label>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                                Disabled workflows cannot be triggered
                            </p>
                        </div>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>

                    {/* Recipe / Steps */}
                    {isCompiled ? (
                        <div className="space-y-1.5">
                            <Label className="text-sm text-muted-foreground">Recipe (read-only)</Label>
                            <div className="rounded-lg border bg-muted/30 p-3 max-h-60 overflow-y-auto">
                                <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                                    {JSON.stringify(workflow?.recipe, null, 2)}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Step builder */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm text-muted-foreground">Steps</Label>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm">
                                                <Plus className="h-4 w-4 mr-1" />
                                                Add Step
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => addStep('tool')}>
                                                <Wrench className="h-4 w-4 mr-2" />
                                                Tool Step
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => addStep('nano_llm')}>
                                                <Brain className="h-4 w-4 mr-2" />
                                                LLM Step
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>

                                {steps.length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                                        No steps yet. Add a tool or LLM step to get started.
                                    </p>
                                )}

                                {steps.map((step, idx) => (
                                    <div
                                        key={step.id}
                                        className="rounded-lg border p-4 space-y-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {step.type === 'tool' ? (
                                                    <Wrench className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <Brain className="h-4 w-4 text-muted-foreground" />
                                                )}
                                                <span className="text-sm font-medium">
                                                    Step {idx + 1}: {step.type === 'tool' ? 'Tool' : 'LLM'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={idx === 0}
                                                    onClick={() => moveStep(step.id, 'up')}
                                                >
                                                    <ChevronUp className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={idx === steps.length - 1}
                                                    onClick={() => moveStep(step.id, 'down')}
                                                >
                                                    <ChevronDown className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                                    onClick={() => removeStep(step.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        {step.type === 'tool' ? (
                                            <>
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs text-muted-foreground">
                                                        Tool Name
                                                    </Label>
                                                    <Input
                                                        placeholder="e.g. web_search"
                                                        value={step.tool}
                                                        onChange={(e) =>
                                                            updateStep(step.id, { tool: e.target.value })
                                                        }
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-xs text-muted-foreground">
                                                            Arguments
                                                        </Label>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 text-xs"
                                                            onClick={() => addStepArg(step.id)}
                                                        >
                                                            <Plus className="h-3 w-3 mr-1" />
                                                            Add
                                                        </Button>
                                                    </div>
                                                    {step.args.map((arg, argIdx) => (
                                                        <div
                                                            key={argIdx}
                                                            className="flex items-center gap-2"
                                                        >
                                                            <Input
                                                                placeholder="Key"
                                                                value={arg.key}
                                                                onChange={(e) =>
                                                                    updateStepArg(
                                                                        step.id,
                                                                        argIdx,
                                                                        'key',
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                className="flex-1"
                                                            />
                                                            <Input
                                                                placeholder="Value"
                                                                value={arg.value}
                                                                onChange={(e) =>
                                                                    updateStepArg(
                                                                        step.id,
                                                                        argIdx,
                                                                        'value',
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                className="flex-1"
                                                            />
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                                                onClick={() =>
                                                                    removeStepArg(step.id, argIdx)
                                                                }
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground">
                                                    Prompt
                                                </Label>
                                                <Textarea
                                                    placeholder="Enter the LLM prompt for this step..."
                                                    value={step.prompt}
                                                    onChange={(e) =>
                                                        updateStep(step.id, { prompt: e.target.value })
                                                    }
                                                    rows={3}
                                                    className="resize-none"
                                                />
                                            </div>
                                        )}

                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-muted-foreground">
                                                Output Key
                                            </Label>
                                            <Input
                                                placeholder="e.g. search_results"
                                                value={step.outputKey}
                                                onChange={(e) =>
                                                    updateStep(step.id, { outputKey: e.target.value })
                                                }
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Input parameters */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm text-muted-foreground">
                                        Input Parameters
                                    </Label>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={addInputParam}
                                    >
                                        <Plus className="h-4 w-4 mr-1" />
                                        Add Parameter
                                    </Button>
                                </div>

                                {inputParams.length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                                        No input parameters. Users can provide values when running.
                                    </p>
                                )}

                                {inputParams.map((param) => (
                                    <div
                                        key={param.id}
                                        className="rounded-lg border p-3 space-y-2"
                                    >
                                        <div className="flex items-start gap-2">
                                            <div className="flex-1 space-y-2">
                                                <Input
                                                    placeholder="Parameter name"
                                                    value={param.name}
                                                    onChange={(e) =>
                                                        updateInputParam(param.id, {
                                                            name: e.target.value,
                                                        })
                                                    }
                                                />
                                                <div className="flex gap-2">
                                                    <Select
                                                        value={param.type}
                                                        onValueChange={(v) =>
                                                            updateInputParam(param.id, {
                                                                type: v as 'string' | 'number' | 'boolean',
                                                            })
                                                        }
                                                    >
                                                        <SelectTrigger className="w-[120px]">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="string">String</SelectItem>
                                                            <SelectItem value="number">Number</SelectItem>
                                                            <SelectItem value="boolean">Boolean</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <Input
                                                        placeholder="Description"
                                                        value={param.description}
                                                        onChange={(e) =>
                                                            updateInputParam(param.id, {
                                                                description: e.target.value,
                                                            })
                                                        }
                                                        className="flex-1"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={param.required}
                                                        onCheckedChange={(v) =>
                                                            updateInputParam(param.id, {
                                                                required: v,
                                                            })
                                                        }
                                                    />
                                                    <Label className="text-xs text-muted-foreground">
                                                        Required
                                                    </Label>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                                onClick={() => removeInputParam(param.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button disabled={submitting || !canSubmit} onClick={handleSubmit}>
                        {submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                {isEdit ? 'Updating...' : 'Creating...'}
                            </>
                        ) : isEdit ? (
                            'Update Workflow'
                        ) : (
                            'Create Workflow'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
