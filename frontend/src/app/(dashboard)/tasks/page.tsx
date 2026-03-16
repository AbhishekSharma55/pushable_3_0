import { CheckSquare } from 'lucide-react';

export default function TasksPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <CheckSquare className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
                    <p className="text-sm text-muted-foreground">
                        Monitor and manage agent tasks
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    No tasks yet. Tasks will appear here when agents start working.
                </p>
            </div>
        </div>
    );
}
