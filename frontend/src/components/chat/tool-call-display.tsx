'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCircle2,
    Circle,
    Loader2,
    ChevronDown,
    ChevronRight,
    ListTodo,
    Wrench,
    BookOpen,
    Zap,
    Clock,
    Bot,
    Plug,
    Globe,
    Radio,
    XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolCallEvent {
    id: string;
    name: string;
    args?: string;
    fullArgs?: Record<string, unknown>;
    type: 'tool' | 'agent';
    status: 'running' | 'done' | 'pending_approval' | 'approved' | 'rejected';
    result?: string;
}

interface ToolCallDisplayProps {
    toolCalls: ToolCallEvent[];
    messageId: string;
}

const PLANNING_TOOLS = new Set(['write_todos', 'update_todo', 'get_todos']);

function classifyTool(name: string): 'planning' | 'system' | 'integration' | 'browser' | 'agent' | 'tool' {
    if (PLANNING_TOOLS.has(name)) return 'planning';
    if (name.startsWith('system_')) return 'system';
    if (name.startsWith('COMPOSIO_') || name.startsWith('composio_')) return 'integration';
    if (name.startsWith('browser_')) return 'browser';
    if (name.startsWith('agent_') || name.startsWith('Delegating')) return 'agent';
    return 'tool';
}

function getToolIcon(name: string) {
    const category = classifyTool(name);
    switch (category) {
        case 'planning': return ListTodo;
        case 'system':
            if (name.includes('kb') || name.includes('document')) return BookOpen;
            if (name.includes('skill')) return Zap;
            if (name.includes('schedule')) return Clock;
            if (name.includes('agent')) return Bot;
            if (name.includes('channel')) return Radio;
            if (name.includes('tool')) return Wrench;
            return Wrench;
        case 'integration': return Plug;
        case 'browser': return Globe;
        case 'agent': return Bot;
        default: return Wrench;
    }
}

function formatToolName(name: string): string {
    return name
        .replace(/^system_/, '')
        .replace(/^(Delegating to |Delegated to )/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Build plan state from tool calls - uses fullArgs when available, falls back to result parsing
function buildPlanState(toolCalls: ToolCallEvent[]) {
    let plan: Array<{ id: string; title: string; status: string; result?: string }> | null = null;

    for (const tc of toolCalls) {
        if (tc.name === 'write_todos') {
            // Try fullArgs first
            if (tc.fullArgs?.todos && Array.isArray(tc.fullArgs.todos)) {
                plan = (tc.fullArgs.todos as Array<{ id: string; title: string }>).map((t) => ({
                    id: t.id,
                    title: t.title,
                    status: 'pending',
                }));
            } else if (tc.result) {
                // Parse from result string: "Plan created with N steps:\n1. [pending] Title"
                const lines = tc.result.split('\n').filter((l) => /^\d+\.\s/.test(l));
                if (lines.length > 0) {
                    plan = lines.map((line, i) => {
                        const match = line.match(/^\d+\.\s+\[(\w+)\]\s+(.+)$/);
                        return {
                            id: `step_${i + 1}`,
                            title: match ? match[2] : line.replace(/^\d+\.\s+/, ''),
                            status: match ? match[1] : 'pending',
                        };
                    });
                }
            }
            continue;
        }

        if (tc.name === 'update_todo' && plan) {
            let stepId: string | undefined;
            let stepStatus: string | undefined;
            let stepResult: string | undefined;

            // Try fullArgs
            if (tc.fullArgs) {
                stepId = tc.fullArgs.id as string;
                stepStatus = tc.fullArgs.status as string;
                stepResult = tc.fullArgs.result as string | undefined;
            }
            // Fallback: parse from result string
            if (!stepId && tc.result) {
                const idMatch = tc.result.match(/Updated "(.+?)" to (\w+)/);
                if (idMatch) {
                    stepStatus = idMatch[2];
                    // Find step by title
                    const step = plan.find((s) => s.title === idMatch[1]);
                    if (step) stepId = step.id;
                }
            }

            if (stepId && stepStatus) {
                const step = plan.find((s) => s.id === stepId);
                if (step) {
                    step.status = stepStatus;
                    if (stepResult) step.result = stepResult;
                }
            }
        }
    }
    return plan;
}

function PlanCard({ plan }: { plan: Array<{ id: string; title: string; status: string; result?: string }> }) {
    const completed = plan.filter((s) => s.status === 'completed').length;
    const total = plan.length;
    const allDone = completed === total;
    const progress = total > 0 ? (completed / total) * 100 : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="rounded-xl border border-border bg-card overflow-hidden"
        >
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                        <ListTodo className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="text-sm font-medium">Plan</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">{completed}/{total}</span>
                    {allDone && (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        >
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                        </motion.div>
                    )}
                </div>
            </div>
            <div className="h-0.5 bg-muted">
                <motion.div
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                />
            </div>
            <div className="p-2 space-y-0.5">
                {plan.map((step, i) => (
                    <motion.div
                        key={`${step.id}-${i}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05, duration: 0.2 }}
                        className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg"
                    >
                        <div className="mt-0.5 flex-shrink-0">
                            {step.status === 'completed' ? (
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                                >
                                    <CheckCircle2 className="h-4 w-4 text-primary" />
                                </motion.div>
                            ) : step.status === 'in_progress' ? (
                                <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                            ) : (
                                <Circle className="h-4 w-4 text-muted-foreground/30" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={cn(
                                "text-sm",
                                step.status === 'completed'
                                    ? 'text-muted-foreground'
                                    : step.status === 'in_progress'
                                        ? 'text-foreground font-medium'
                                        : 'text-muted-foreground'
                            )}>
                                {step.title}
                            </p>
                            {step.result && (
                                <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                                    {step.result}
                                </p>
                            )}
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.div>
    );
}

function ActionCall({ tc, index }: { tc: ToolCallEvent; index: number }) {
    const [expanded, setExpanded] = useState(false);
    const Icon = getToolIcon(tc.name);
    const isDone = tc.status === 'done';
    const isRunning = tc.status === 'running';
    const isRejected = tc.status === 'rejected';

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04, duration: 0.2 }}
        >
            <button
                className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-all",
                    isRejected
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border bg-card hover:bg-muted/50"
                )}
                onClick={() => isDone && setExpanded(!expanded)}
            >
                <div className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0",
                    isDone ? "bg-primary/10" : isRunning ? "bg-muted" : isRejected ? "bg-destructive/10" : "bg-muted"
                )}>
                    {isDone ? (
                        <Icon className="h-3 w-3 text-primary" />
                    ) : isRunning ? (
                        <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
                    ) : isRejected ? (
                        <XCircle className="h-3 w-3 text-destructive" />
                    ) : (
                        <Icon className="h-3 w-3 text-muted-foreground" />
                    )}
                </div>
                <span className={cn(
                    "flex-1 text-left truncate",
                    isDone ? "text-foreground" : "text-muted-foreground"
                )}>
                    {formatToolName(tc.name)}
                </span>
                {isDone && tc.result && (
                    <span className="text-muted-foreground truncate max-w-[200px] hidden sm:inline text-[11px]">
                        {tc.result.slice(0, 60)}
                    </span>
                )}
                {isDone && (
                    expanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                )}
            </button>
            <AnimatePresence>
                {expanded && isDone && tc.result && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground font-mono max-h-[160px] overflow-y-auto whitespace-pre-wrap">
                            {tc.result}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

export function ToolCallDisplay({ toolCalls, messageId }: ToolCallDisplayProps) {
    const [expanded, setExpanded] = useState(false);

    if (!toolCalls || toolCalls.length === 0) return null;

    const hasPlanningCalls = toolCalls.some((tc) => PLANNING_TOOLS.has(tc.name));
    const plan = hasPlanningCalls ? buildPlanState(toolCalls) : null;
    const actionCalls = toolCalls.filter((tc) => !PLANNING_TOOLS.has(tc.name));

    const latestAction = actionCalls[actionCalls.length - 1];
    const isRunning = actionCalls.some((tc) => tc.status === 'running');
    const hasErrors = actionCalls.some((tc) => tc.status === 'rejected');

    return (
        <div className="space-y-3">
            {plan && plan.length > 0 && (
                <PlanCard plan={plan} />
            )}
            {actionCalls.length > 0 && (
                <div>
                    {/* Accordion bar */}
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className={cn(
                            "w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs transition-all",
                            "text-left cursor-pointer",
                            isRunning
                                ? "border-border bg-card hover:bg-muted/50"
                                : "border-border/60 bg-muted/40 hover:bg-muted/60"
                        )}
                    >
                        {isRunning ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                        ) : hasErrors ? (
                            <XCircle className="w-4 h-4 text-destructive shrink-0" />
                        ) : (
                            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        )}
                        <span className="font-medium text-foreground/80 truncate flex-1">
                            {isRunning
                                ? `Using ${formatToolName(latestAction.name)}...`
                                : `Used ${actionCalls.length} tool${actionCalls.length !== 1 ? 's' : ''}`}
                        </span>
                        <ChevronRight
                            className={cn(
                                "w-3.5 h-3.5 text-muted-foreground/50 shrink-0 transition-transform duration-150",
                                expanded && "rotate-90"
                            )}
                        />
                    </button>

                    {/* Expanded tool list */}
                    <AnimatePresence>
                        {expanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                            >
                                <div className="mt-1.5 space-y-1">
                                    {actionCalls.map((tc, j) => (
                                        <ActionCall key={`${messageId}-action-${j}`} tc={tc} index={j} />
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}
