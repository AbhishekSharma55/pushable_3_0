'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    CreditCard,
    Zap,
    TrendingUp,
    ArrowUpRight,
    ArrowDownRight,
    Loader2,
    Package,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getCreditBalance, getCreditLedger, devTopup } from '@/lib/api/credits';
import type { CreditBalance, LedgerEntry } from '@/types';

const TYPE_LABELS: Record<string, string> = {
    subscription_grant: 'Subscription',
    topup: 'Top-up',
    chat_message: 'Chat Message',
    scheduled_prompt: 'Scheduled Prompt',
    kb_upload: 'KB Upload',
    kb_query: 'KB Query',
    browser_action: 'Browser Action',
    scheduled_run_fee: 'Scheduled Run',
    agent_delegation: 'Agent Delegation',
    overage: 'Overage',
    refund: 'Refund',
    manual_adjustment: 'Adjustment',
};

const TYPE_COLORS: Record<string, string> = {
    chat_message: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    task_run: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
    kb_upload: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    kb_query: 'bg-teal-500/10 text-teal-600 border-teal-500/20',
    browser_action: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    subscription_grant: 'bg-green-500/10 text-green-600 border-green-500/20',
    topup: 'bg-green-500/10 text-green-600 border-green-500/20',
};

const TOPUP_PACKS = [
    { name: 'Starter Pack', credits: 5000, price: 199 },
    { name: 'Growth Pack', credits: 25000, price: 799 },
    { name: 'Power Pack', credits: 100000, price: 2499 },
    { name: 'Enterprise Pack', credits: 500000, price: 9999 },
];

const QUICK_AMOUNTS = [1000, 5000, 10000, 50000, 100000, 500000];

export default function CreditsPage() {
    const workspace = useActiveWorkspace();
    const [balance, setBalance] = useState<CreditBalance | null>(null);
    const [ledger, setLedger] = useState<LedgerEntry[]>([]);
    const [loading, setLoading] = useState(true);

    // Dev top-up popup state
    const [showTopup, setShowTopup] = useState(false);
    const [topupAmount, setTopupAmount] = useState('10000');
    const [topupLoading, setTopupLoading] = useState(false);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [bal, led] = await Promise.all([
                getCreditBalance(workspace.id),
                getCreditLedger(workspace.id, { limit: 50 }),
            ]);
            setBalance(bal);
            setLedger(led.data);
        } catch {
            // silently fail
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Ctrl/Cmd + ; to open dev top-up popup
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === ';') {
                e.preventDefault();
                setShowTopup((prev) => !prev);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const handleTopup = async () => {
        if (!workspace) return;
        const amount = Number(topupAmount);
        if (!amount || amount <= 0) return;
        try {
            setTopupLoading(true);
            await devTopup(workspace.id, amount);
            await fetchData();
            setShowTopup(false);
        } catch {
            // silently fail
        } finally {
            setTopupLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[calc(100vh-120px)] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Dev Top-up Popup (Ctrl/Cmd + ;) */}
            <Dialog open={showTopup} onOpenChange={setShowTopup}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Dev Top-up</DialogTitle>
                        <DialogDescription>
                            Quickly add credits for development. Press Ctrl/Cmd + ; to toggle.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground mb-2 block">
                                Quick amounts
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                {QUICK_AMOUNTS.map((amt) => (
                                    <button
                                        key={amt}
                                        type="button"
                                        onClick={() => setTopupAmount(String(amt))}
                                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                                            topupAmount === String(amt)
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-border/60 bg-card hover:bg-muted/50'
                                        }`}
                                    >
                                        {amt.toLocaleString()}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                                Custom amount
                            </label>
                            <input
                                type="number"
                                value={topupAmount}
                                onChange={(e) => setTopupAmount(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleTopup();
                                }}
                                min={1}
                                max={10000000}
                                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                                placeholder="Enter amount..."
                                autoFocus
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowTopup(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleTopup} disabled={topupLoading || !topupAmount}>
                            {topupLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Zap className="h-4 w-4 mr-2" />
                            )}
                            Add {Number(topupAmount).toLocaleString()} credits
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                    <CreditCard className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Credits & Billing</h1>
                    <p className="text-sm text-muted-foreground">
                        Manage your credit balance and view usage
                    </p>
                </div>
            </div>

            {/* Balance Cards */}
            {balance && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-border/60 bg-card p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <Zap className="h-4 w-4 text-amber-600" />
                            <span className="text-sm font-medium text-muted-foreground">Available Credits</span>
                        </div>
                        <p className="text-3xl font-bold">
                            {balance.availableCredits.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Plan: {balance.planCredits.toLocaleString()} + Top-up: {balance.topupCredits.toLocaleString()}
                        </p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <TrendingUp className="h-4 w-4 text-blue-600" />
                            <span className="text-sm font-medium text-muted-foreground">Total Consumed</span>
                        </div>
                        <p className="text-3xl font-bold">
                            {balance.totalConsumed.toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Lifetime usage</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card p-5">
                        <div className="flex items-center gap-2 mb-3">
                            <CreditCard className="h-4 w-4 text-violet-600" />
                            <span className="text-sm font-medium text-muted-foreground">Overage</span>
                        </div>
                        <p className="text-3xl font-bold">
                            {balance.overageEnabled ? 'Enabled' : 'Disabled'}
                        </p>
                        {balance.overageEnabled && (
                            <p className="text-xs text-muted-foreground mt-1">
                                Limit: {balance.overageLimit.toLocaleString()} credits
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Top-up Packs */}
            <div>
                <h2 className="text-lg font-semibold mb-4">Top-up Packs</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {TOPUP_PACKS.map((pack) => (
                        <div
                            key={pack.name}
                            className="rounded-xl border border-border/60 bg-card p-5 relative"
                        >
                            <Badge
                                variant="outline"
                                className="absolute top-3 right-3 text-[9px] bg-muted/50"
                            >
                                Coming soon
                            </Badge>
                            <Package className="h-5 w-5 text-muted-foreground mb-3" />
                            <p className="font-semibold">{pack.name}</p>
                            <p className="text-2xl font-bold mt-1">
                                {pack.credits.toLocaleString()}
                                <span className="text-sm font-normal text-muted-foreground ml-1">credits</span>
                            </p>
                            <p className="text-sm text-muted-foreground mt-2">
                                &#8377;{pack.price.toLocaleString()}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Ledger */}
            <div>
                <h2 className="text-lg font-semibold mb-4">Credit Ledger</h2>
                {ledger.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                        <p className="text-sm text-muted-foreground">No transactions yet.</p>
                    </div>
                ) : (
                    <div className="rounded-xl border border-border/60 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border/40 bg-muted/30">
                                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Date</th>
                                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                                        <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Amount</th>
                                        <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Balance After</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ledger.map((entry) => {
                                        const isPositive = entry.amount > 0;
                                        return (
                                            <tr key={entry.id} className="border-b border-border/20 last:border-b-0">
                                                <td className="px-4 py-2.5 text-muted-foreground">
                                                    {new Date(entry.createdAt).toLocaleDateString('en-US', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[entry.type] || 'bg-muted/50'}`}
                                                    >
                                                        {TYPE_LABELS[entry.type] || entry.type}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono">
                                                    <span className={`flex items-center justify-end gap-1 ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                                                        {isPositive ? (
                                                            <ArrowUpRight className="h-3 w-3" />
                                                        ) : (
                                                            <ArrowDownRight className="h-3 w-3" />
                                                        )}
                                                        {isPositive ? '+' : ''}{entry.amount}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                                                    {entry.creditsAfter.toLocaleString()}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
