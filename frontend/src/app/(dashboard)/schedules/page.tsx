import { Clock } from 'lucide-react';

export default function SchedulesPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Schedules</h1>
                    <p className="text-sm text-muted-foreground">
                        Automate tasks with cron-based scheduling
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    No schedules yet. Set up recurring tasks and workflow runs.
                </p>
            </div>
        </div>
    );
}
