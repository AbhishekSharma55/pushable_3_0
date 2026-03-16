import { CreditCard } from 'lucide-react';

export default function CreditsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Credits</h1>
                    <p className="text-sm text-muted-foreground">
                        View your credit balance and usage history
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    Credit usage details will appear here once agents start processing.
                </p>
            </div>
        </div>
    );
}
