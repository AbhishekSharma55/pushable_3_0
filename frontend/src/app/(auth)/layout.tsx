import { Bot } from 'lucide-react';

export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
            <div className="w-full max-w-md space-y-8 px-4">
                <div className="flex flex-col items-center space-y-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
                        <Bot className="h-7 w-7" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Pushable AI</h1>
                    <p className="text-sm text-muted-foreground">
                        Your AI Employee Platform
                    </p>
                </div>
                {children}
            </div>
        </div>
    );
}
