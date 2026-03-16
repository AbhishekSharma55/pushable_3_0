import { Radio } from 'lucide-react';

export default function ChannelsPage() {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Radio className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
                    <p className="text-sm text-muted-foreground">
                        Connect Telegram, Slack and more as input channels
                    </p>
                </div>
            </div>
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60">
                <p className="text-muted-foreground">
                    No channels configured. Connect messaging platforms to your agents.
                </p>
            </div>
        </div>
    );
}
