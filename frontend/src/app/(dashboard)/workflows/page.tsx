import { GitBranch } from 'lucide-react';

export default function WorkflowsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <GitBranch className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
                    <p className="text-sm text-muted-foreground">
                        Build multi-step agent workflows
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    No workflows yet. Chain tasks together to create complex automations.
                </p>
            </div>
        </div>
    );
}
