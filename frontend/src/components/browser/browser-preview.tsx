'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Loader2, WifiOff, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BrowserPreviewProps {
    wsUrl: string;
    sessionId: string;
    onClose: () => void;
}

export function BrowserPreview({ wsUrl, sessionId, onClose }: BrowserPreviewProps) {
    const imgRef = useRef<HTMLImageElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const mountedRef = useRef(true);
    const prevUrlRef = useRef<string | null>(null);
    const reconnectCount = useRef(0);
    const reconnectTimer = useRef<NodeJS.Timeout | undefined>(undefined);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [frameCount, setFrameCount] = useState(0);

    const connect = useCallback(() => {
        // Close any existing connection first
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
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current) return;

            console.log('[BrowserPreview] frame received:', event.data instanceof ArrayBuffer ? `${event.data.byteLength} bytes` : typeof event.data);

            if (!(event.data instanceof ArrayBuffer)) return;

            // Revoke previous object URL to prevent memory leak
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
            setStatus('disconnected');
            if (event.code !== 1000 && reconnectCount.current < 5) {
                reconnectTimer.current = setTimeout(() => {
                    if (!mountedRef.current) return;
                    reconnectCount.current++;
                    connect();
                }, 2000);
            }
        };

        ws.onerror = () => {
            // onclose will fire after this
        };
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
                    <span className="text-sm font-medium">Live Browser Preview (v2)</span>
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
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Preview area */}
            <div className="relative bg-neutral-900 aspect-[16/10]">
                <img
                    ref={imgRef}
                    alt="Browser preview"
                    className="block w-full h-full object-contain"
                    style={{ minHeight: '100%', minWidth: '100%' }}
                    draggable={false}
                />

                {status === 'connecting' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Connecting to browser...</span>
                        </div>
                    </div>
                )}

                {status === 'disconnected' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                        <div className="flex flex-col items-center gap-3">
                            <WifiOff className="h-6 w-6 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Connection lost</span>
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
