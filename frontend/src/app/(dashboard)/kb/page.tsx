import { BookOpen } from 'lucide-react';

export default function KnowledgeBasePage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Knowledge Base</h1>
                    <p className="text-sm text-muted-foreground">
                        Manage documents and knowledge for your agents
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    No knowledge bases yet. Upload documents to train your agents.
                </p>
            </div>
        </div>
    );
}
