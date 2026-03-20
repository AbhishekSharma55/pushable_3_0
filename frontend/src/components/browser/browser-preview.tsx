'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Loader2, WifiOff, Monitor, Mouse, Keyboard, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBrowserInteraction } from '@/hooks/use-browser-interaction';

interface BrowserPreviewProps {
    wsUrl: string;
    sessionId: string;
    onClose: () => void;
    proxied?: boolean;
    proxyLabel?: string;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY = 1000; // 1s, doubles each attempt up to 8s

export function BrowserPreview({ wsUrl, sessionId, onClose, proxied, proxyLabel }: BrowserPreviewProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const mountedRef = useRef(true);
    const prevUrlRef = useRef<string | null>(null);
    const reconnectCount = useRef(0);
    const reconnectTimer = useRef<NodeJS.Timeout | undefined>(undefined);
    const canvasRef = useRef<HTMLDivElement>(null);
    const lastFrameTime = useRef(0);

    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'server-restarted'>('connecting');
    const [frameCount, setFrameCount] = useState(0);

    // ── Interactive browser control ──
    const { isFocused, cursorPos, containerProps: interactionProps } = useBrowserInteraction({
        wsRef,
        imgRef,
        containerRef: canvasRef,
        enabled: status === 'connected',
    });

    const connect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.onerror = null;
            wsRef.current.onmessage = null;
            if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
                wsRef.current.close();
            }
            wsRef.current = null;
        }

        if (!mountedRef.current) return;

        setStatus('connecting');
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mountedRef.current) {
                ws.close();
                return;
            }
            setStatus('connected');
            reconnectCount.current = 0;
            lastFrameTime.current = Date.now();
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current) return;

            // Handle text messages (ping/pong)
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'ping') {
                        // Respond with pong to keep connection alive
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'pong' }));
                        }
                    }
                } catch {
                    // ignore
                }
                return;
            }

            if (!(event.data instanceof ArrayBuffer)) return;

            lastFrameTime.current = Date.now();

            if (prevUrlRef.current) {
                URL.revokeObjectURL(prevUrlRef.current);
            }

            const blob = new Blob([event.data], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            prevUrlRef.current = url;

            if (imgRef.current) {
                imgRef.current.src = url;
            }

            setFrameCount((c) => c + 1);
        };

        ws.onclose = (event) => {
            if (!mountedRef.current) return;

            // Code 1006 = abnormal closure (server process died)
            if (event.code === 1006) {
                setStatus('server-restarted');
                return;
            }

            // Code 4004 = session not found (server says session doesn't exist)
            if (event.code === 4004) {
                setStatus('server-restarted');
                return;
            }

            // Code 1000 = normal closure (session explicitly ended)
            if (event.code === 1000) {
                setStatus('disconnected');
                return;
            }

            // For other codes, attempt reconnection with exponential backoff
            setStatus('disconnected');
            if (reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
                const delay = Math.min(
                    RECONNECT_BASE_DELAY * Math.pow(2, reconnectCount.current),
                    8000
                );
                reconnectTimer.current = setTimeout(() => {
                    if (!mountedRef.current) return;
                    reconnectCount.current++;
                    connect();
                }, delay);
            }
        };

        ws.onerror = () => {};
    }, [wsUrl]);

    useEffect(() => {
        mountedRef.current = true;
        connect();
        return () => {
            mountedRef.current = false;
            clearTimeout(reconnectTimer.current);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.onerror = null;
                wsRef.current.onmessage = null;
                wsRef.current.close();
                wsRef.current = null;
            }
            if (prevUrlRef.current) {
                URL.revokeObjectURL(prevUrlRef.current);
                prevUrlRef.current = null;
            }
        };
    }, [connect]);

    // Stale frame detection: if no frames for 15s while "connected", try reconnecting
    useEffect(() => {
        if (status !== 'connected') return;
        const interval = setInterval(() => {
            if (!mountedRef.current || status !== 'connected') return;
            const elapsed = Date.now() - lastFrameTime.current;
            if (elapsed > 15000 && wsRef.current) {
                // Connection is likely stale — force reconnect
                wsRef.current.close();
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [status]);

    const handleReconnect = () => {
        reconnectCount.current = 0;
        connect();
    };

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Live Browser Preview</span>
                    {frameCount > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1">{frameCount}f</span>
                    )}
                    <div
                        className={`h-2 w-2 rounded-full ${
                            status === 'connected'
                                ? 'bg-emerald-500'
                                : status === 'connecting'
                                  ? 'bg-amber-500 animate-pulse'
                                  : 'bg-red-500'
                        }`}
                    />
                    {isFocused && (
                        <span className="text-[10px] text-emerald-600 flex items-center gap-1 ml-1">
                            <Keyboard className="h-3 w-3" />
                            Active
                        </span>
                    )}
                    {proxied && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-500/10 text-violet-600 border-violet-500/20 ml-1.5">
                            <Shield className="h-2.5 w-2.5 mr-0.5" />
                            {proxyLabel || 'Proxied'}
                        </Badge>
                    )}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Interactive preview area */}
            <div
                ref={canvasRef}
                {...interactionProps}
                className="relative bg-neutral-900 aspect-[16/10]"
                style={{ outline: 'none', cursor: isFocused ? 'none' : 'default' }}
            >
                <img
                    ref={imgRef}
                    alt="Browser preview"
                    className="block w-full h-full object-contain select-none"
                    style={{ minHeight: '100%', minWidth: '100%' }}
                    draggable={false}
                />

                {/* Custom cursor indicator */}
                {isFocused && cursorPos && (
                    <div
                        className="absolute pointer-events-none z-20"
                        style={{ left: cursorPos.x, top: cursorPos.y, transform: 'translate(-50%, -50%)' }}
                    >
                        <div className="w-4 h-4 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_0_4px_rgba(0,0,0,0.4)]" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1 h-1 rounded-full bg-white/90" />
                        </div>
                    </div>
                )}

                {/* Click to interact overlay */}
                {!isFocused && status === 'connected' && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="bg-black/50 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-sm">
                            <Mouse className="h-3.5 w-3.5" />
                            Click to interact
                        </div>
                    </div>
                )}

                {/* Keyboard active indicator */}
                {isFocused && (
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1 pointer-events-none z-20">
                        <Keyboard className="h-3 w-3" />
                        Keyboard active
                    </div>
                )}

                {status === 'connecting' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-30">
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Connecting to browser...</span>
                        </div>
                    </div>
                )}

                {status === 'server-restarted' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-30">
                        <div className="flex flex-col items-center gap-3">
                            <WifiOff className="h-6 w-6 text-muted-foreground" />
                            <span className="text-sm font-medium">Browser session ended. Start a new one from Settings.</span>
                            <Button variant="outline" size="sm" onClick={handleReconnect}>
                                Try Reconnect
                            </Button>
                        </div>
                    </div>
                )}

                {status === 'disconnected' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-30">
                        <div className="flex flex-col items-center gap-3">
                            <WifiOff className="h-6 w-6 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                {reconnectCount.current >= MAX_RECONNECT_ATTEMPTS
                                    ? 'Could not reconnect. Start a new session.'
                                    : `Connection lost. Reconnecting... (attempt ${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS})`}
                            </span>
                            <Button variant="outline" size="sm" onClick={handleReconnect}>
                                Reconnect
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
