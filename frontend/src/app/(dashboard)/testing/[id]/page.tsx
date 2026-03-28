'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Clock,
    Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getTestSuite, deleteTestSuite } from '@/lib/api/testing';
import type { TestSuite, TestCase } from '@/types';

const statusIcon = (status: string) => {
    switch (status) {
        case 'passed': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
        case 'error': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
        default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
};

const statusColor: Record<string, string> = {
    passed: 'bg-green-500/10 text-green-500 border-green-500/20',
    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    error: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    pending: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

const suiteStatusColor: Record<string, string> = {
    draft: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    running: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    completed: 'bg-green-500/10 text-green-500 border-green-500/20',
};

export default function TestSuiteDetailPage() {
    const { id } = useParams<{ id: string }>();
    const workspace = useActiveWorkspace();
    const router = useRouter();
    const [suite, setSuite] = useState<TestSuite | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedCase, setExpandedCase] = useState<string | null>(null);

    const fetchSuite = useCallback(async () => {
        if (!workspace || !id) return;
        try {
            setLoading(true);
            const data = await getTestSuite(workspace.id, id);
            setSuite(data);
        } catch {
            toast.error('Failed to load test suite');
        } finally {
            setLoading(false);
        }
    }, [workspace, id]);

    useEffect(() => { fetchSuite(); }, [fetchSuite]);

    const handleDelete = async () => {
        if (!workspace || !id) return;
        try {
            await deleteTestSuite(workspace.id, id);
            toast.success('Test suite deleted');
            router.push('/testing');
        } catch {
            toast.error('Failed to delete suite');
        }
    };

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto space-y-6">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-20 rounded-xl" />
                <Skeleton className="h-60 rounded-xl" />
            </div>
        );
    }

    if (!suite) {
        return (
            <div className="p-6 max-w-5xl mx-auto text-center py-20">
                <p className="text-muted-foreground">Test suite not found.</p>
                <Button variant="outline" className="mt-4" onClick={() => router.push('/testing')}>
                    Back to Testing
                </Button>
            </div>
        );
    }

    const cases = suite.cases || [];
    const stats = suite.stats || { total: 0, passed: 0, failed: 0, pending: 0, error: 0 };
    const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Back */}
            <button
                onClick={() => router.push('/testing')}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Testing
            </button>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{suite.agent?.emoji || '🤖'}</span>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold">{suite.name}</h1>
                                <Badge variant="outline" className={suiteStatusColor[suite.status]}>
                                    {suite.status}
                                </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Agent: {suite.agent?.name || suite.agentId}
                                {suite.description && ` — ${suite.description}`}
                            </p>
                        </div>
                    </div>
                </div>
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                </Button>
            </div>

            {/* Stats bar */}
            <div className="border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">Results</span>
                    <span className="text-sm text-muted-foreground">{stats.passed}/{stats.total} passed ({passRate}%)</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                    {stats.passed > 0 && (
                        <div className="bg-green-500 h-full" style={{ width: `${(stats.passed / stats.total) * 100}%` }} />
                    )}
                    {stats.failed > 0 && (
                        <div className="bg-red-500 h-full" style={{ width: `${(stats.failed / stats.total) * 100}%` }} />
                    )}
                    {stats.error > 0 && (
                        <div className="bg-orange-500 h-full" style={{ width: `${(stats.error / stats.total) * 100}%` }} />
                    )}
                    {stats.pending > 0 && (
                        <div className="bg-zinc-400 h-full" style={{ width: `${(stats.pending / stats.total) * 100}%` }} />
                    )}
                </div>
                <div className="flex gap-4 mt-2 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Passed: {stats.passed}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Failed: {stats.failed}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Error: {stats.error}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-400" /> Pending: {stats.pending}</span>
                </div>
            </div>

            {/* Test Cases */}
            <div className="space-y-2">
                <h2 className="text-lg font-semibold">Test Cases ({cases.length})</h2>
                {cases.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">No test cases.</p>
                ) : (
                    cases.map((tc) => (
                        <div
                            key={tc.id}
                            className="border rounded-lg overflow-hidden"
                        >
                            <button
                                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                                onClick={() => setExpandedCase(expandedCase === tc.id ? null : tc.id)}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    {statusIcon(tc.status)}
                                    <span className="font-medium text-sm truncate">{tc.title}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {tc.executionTimeMs && (
                                        <span className="text-xs text-muted-foreground">{tc.executionTimeMs}ms</span>
                                    )}
                                    <Badge variant="outline" className={`text-[10px] ${statusColor[tc.status]}`}>
                                        {tc.status}
                                    </Badge>
                                </div>
                            </button>

                            {expandedCase === tc.id && (
                                <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
                                    <div className="pt-3">
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Input</p>
                                        <p className="text-sm mt-1 bg-background rounded p-2 border">{tc.input}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Expected Behavior</p>
                                        <p className="text-sm mt-1 bg-background rounded p-2 border">{tc.expectedBehavior}</p>
                                    </div>
                                    {tc.actualResponse && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Actual Response</p>
                                            <p className="text-sm mt-1 bg-background rounded p-2 border whitespace-pre-wrap max-h-60 overflow-y-auto">
                                                {tc.actualResponse}
                                            </p>
                                        </div>
                                    )}
                                    {tc.evaluationNotes && (
                                        <div>
                                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Evaluation</p>
                                            <p className={`text-sm mt-1 rounded p-2 border ${tc.status === 'passed' ? 'bg-green-500/5 border-green-500/20' : tc.status === 'failed' ? 'bg-red-500/5 border-red-500/20' : 'bg-background'}`}>
                                                {tc.evaluationNotes}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
