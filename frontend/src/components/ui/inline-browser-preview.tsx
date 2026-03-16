"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Monitor, X, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface InlineBrowserPreviewProps {
    /** Whether the agent is currently processing */
    isAgentWorking: boolean;
    /** Current streaming content — used to auto-detect browser activity */
    streamingContent?: string;
    /** Incremented each time the user sends a new message — triggers reset */
    sendCount: number;
}

/** Keywords in streamed text that suggest the agent is using the browser */
const BROWSER_CONTENT_PATTERNS = [
    /\bbrowser\b/i,
    /\bnavigat/i,
    /\bopened?\b.*\b(page|site|website|url|tab)/i,
    /\b(instagram|facebook|twitter|reddit|google|youtube|github|linkedin)\b/i,
    /\blog\s*in/i,
    /\bsign\s*(in|up)/i,
    /\bscreenshot/i,
    /\bclicked?\b/i,
    /\btyping?\b.*\b(field|input|form)/i,
    /\bfill(ed|ing)?\b.*\b(form|field|input)/i,
    /\bsubmit/i,
    /\bweb\s*page/i,
    /\bsearch(ed|ing)?\b.*\b(for|on|in)\b/i,
    /\burl\b/i,
    /Tool Call.*browser/i,
];

function detectBrowserActivity(content: string): boolean {
    if (!content) return false;
    return BROWSER_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}

export function InlineBrowserPreview({
    isAgentWorking,
    streamingContent = "",
    sendCount,
}: InlineBrowserPreviewProps) {
    const [debugUrl, setDebugUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [autoDetected, setAutoDetected] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const fetchedRef = useRef(false);
    const prevSendCountRef = useRef(sendCount);

    // Reset everything when user sends a new message
    useEffect(() => {
        if (sendCount !== prevSendCountRef.current) {
            prevSendCountRef.current = sendCount;
            setDismissed(false);
            setAutoDetected(false);
            setDialogOpen(false);
            setDebugUrl(null);
            setError(false);
            fetchedRef.current = false;
        }
    }, [sendCount]);

    // Auto-detect browser activity from streamed content
    useEffect(() => {
        if (!isAgentWorking || dismissed || autoDetected) return;
        if (detectBrowserActivity(streamingContent)) {
            setAutoDetected(true);
        }
    }, [streamingContent, isAgentWorking, dismissed, autoDetected]);

    // Show the button when browser activity is detected and not dismissed
    const showButton = autoDetected && !dismissed;

    // Fetch the browser session URL
    const fetchSession = useCallback(async () => {
        if (fetchedRef.current || debugUrl) return;
        setLoading(true);
        setError(false);
        try {
            const res = await fetch("/api/browser/session");
            if (res.ok) {
                const data = await res.json();
                setDebugUrl(data.debugUrl);
                fetchedRef.current = true;
            } else {
                setError(true);
            }
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [debugUrl]);

    const handleOpenDialog = () => {
        setDialogOpen(true);
        fetchSession();
    };

    if (!showButton) return null;

    return (
        <>
            {/* Trigger button */}
            <div className="mt-3 flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleOpenDialog}
                    className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
                        "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                        "hover:bg-emerald-500/20 hover:border-emerald-500/60 transition-colors cursor-pointer"
                    )}
                >
                    <div className="relative">
                        <Monitor className="w-4 h-4" />
                        {isAgentWorking && (
                            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                        )}
                    </div>
                    <span>Agent might be using the browser — click to see what it&apos;s doing</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </button>

                {/* Dismiss button */}
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground cursor-pointer"
                    title="Dismiss"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Maximized browser dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent
                    className="flex flex-col p-0 gap-0 overflow-hidden border-border bg-[#1a1a1a] rounded-xl"
                    style={{
                        width: "95vw",
                        maxWidth: "95vw",
                        height: "92vh",
                        maxHeight: "92vh",
                    }}
                >
                    <DialogHeader className="flex flex-row items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-[#1a1a1a] space-y-0">
                        <DialogTitle className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                            <div className="relative">
                                <Monitor className="w-4 h-4 text-emerald-400" />
                                {isAgentWorking && (
                                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                                )}
                            </div>
                            Live Browser
                            {isAgentWorking && (
                                <span className="text-[11px] text-emerald-400/80 animate-pulse font-normal">● Active</span>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Browser content — fills all remaining height */}
                    <div className="flex-1 relative bg-[#1a1a1a] overflow-hidden" style={{ minHeight: 0 }}>
                        {loading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#1a1a1a]">
                                <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
                                <span className="text-sm text-zinc-500">Connecting to browser…</span>
                            </div>
                        )}

                        {error && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#1a1a1a]">
                                <Monitor className="w-8 h-8 text-zinc-600" />
                                <span className="text-sm text-zinc-500">Browser session unavailable</span>
                            </div>
                        )}

                        {debugUrl && !error && (
                            <iframe
                                ref={iframeRef}
                                src={debugUrl}
                                className="absolute inset-0 w-full h-full border-0"
                                title="Agent Browser Preview"
                                sandbox="allow-scripts allow-same-origin allow-popups"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
