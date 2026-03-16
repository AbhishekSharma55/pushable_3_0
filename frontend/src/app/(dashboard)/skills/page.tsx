import { Zap } from 'lucide-react';

export default function SkillsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
                    <p className="text-sm text-muted-foreground">
                        Define reusable skill instructions for your agents
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    No skills yet. Create skills to give your agents specialized abilities.
                </p>
            </div>
        </div>
    );
}
