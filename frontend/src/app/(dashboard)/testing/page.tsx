'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    FlaskConical,
    Trash2,
    Bot,
    MessageSquare,
    Loader2,
    CheckCircle2,
    XCircle,
    Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { listTestSuites, deleteTestSuite, getTesterAgent } from '@/lib/api/testing';
import type { TestSuite } from '@/types';

const statusColors: Record<string, string> = {
    draft: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    running: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    completed: 'bg-green-500/10 text-green-500 border-green-500/20',
};

export default function TestingPage() {
    const workspace = useActiveWorkspace();
    const router = useRouter();
    const [suites, setSuites] = useState<TestSuite[]>([]);
    const [loading, setLoading] = useState(true);
    const [testerId, setTesterId] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [suitesData, tester] = await Promise.all([
                listTestSuites(workspace.id),
                getTesterAgent(workspace.id).catch(() => null),
            ]);
            setSuites(suitesData);
            if (tester) setTesterId(tester.id);
        } catch {
            toast.error('Failed to load test suites');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!workspace) return;
        try {
            await deleteTestSuite(workspace.id, id);
            toast.success('Test suite deleted');
            fetchData();
        } catch {
            toast.error('Failed to delete suite');
        }
    };

    const passRate = (s: TestSuite) => {
        if (!s.stats || s.stats.total === 0) return 0;
        return Math.round((s.stats.passed / s.stats.total) * 100);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Testing</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Test suites and results for your agents.
                    </p>
                </div>
                {testerId && (
                    <Button onClick={() => router.push(`/agents?agent=${testerId}`)}>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Talk to Tester
                    </Button>
                )}
            </div>

            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
            ) : suites.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <FlaskConical className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium">No test suites yet</h3>
                    <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                        Chat with the Tester agent to generate and run test suites for your agents.
                    </p>
                    {testerId && (
                        <Button className="mt-4" onClick={() => router.push(`/agents?agent=${testerId}`)}>
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Talk to Tester
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {suites.map((suite) => {
                        const rate = passRate(suite);
                        const stats = suite.stats;
                        return (
                            <div
                                key={suite.id}
                                className="border rounded-xl p-5 hover:border-foreground/20 transition-colors cursor-pointer group"
                                onClick={() => router.push(`/testing/${suite.id}`)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <span className="text-2xl">{suite.agent?.emoji || '🤖'}</span>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-semibold truncate">{suite.name}</h3>
                                                <Badge variant="outline" className={statusColors[suite.status] || statusColors.draft}>
                                                    {suite.status}
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground truncate">
                                                Agent: {suite.agent?.name || suite.agentId}
                                                {suite.description && ` — ${suite.description}`}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        {stats && stats.total > 0 && (
                                            <div className="flex items-center gap-3 text-sm">
                                                <span className="flex items-center gap-1 text-green-500">
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> {stats.passed}
                                                </span>
                                                <span className="flex items-center gap-1 text-red-500">
                                                    <XCircle className="h-3.5 w-3.5" /> {stats.failed}
                                                </span>
                                                {stats.pending > 0 && (
                                                    <span className="flex items-center gap-1 text-muted-foreground">
                                                        <Clock className="h-3.5 w-3.5" /> {stats.pending}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {stats && stats.total > 0 && (
                                            <div className="w-24">
                                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${rate === 100 ? 'bg-green-500' : rate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                        style={{ width: `${rate}%` }}
                                                    />
                                                </div>
                                                <p className="text-[10px] text-muted-foreground text-center mt-0.5">{rate}%</p>
                                            </div>
                                        )}

                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete test suite?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This will delete &quot;{suite.name}&quot; and all its test cases. This cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={(e) => handleDelete(e, suite.id)}>Delete</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
