'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft,
    Monitor,
    Loader2,
    WifiOff,
    Square,
    Maximize2,
    Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { endSession } from '@/lib/api/browser';
import { BROWSER_WS_URL } from '@/lib/constants';

export default function BrowserSessionPage() {
    const params = useParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();
    const sessionId = params.sessionId as string;
    const wsUrl = `${BROWSER_WS_URL}/ws/${sessionId}`;

    const imgRef = useRef<HTMLImageElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const mountedRef = useRef(true);
    const prevUrlRef = useRef<string | null>(null);
    const reconnectCount = useRef(0);
    const reconnectTimer = useRef<NodeJS.Timeout | undefined>(undefined);

    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [frameCount, setFrameCount] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

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
            if (!mountedRef.current) { ws.close(); return; }
            setStatus('connected');
            reconnectCount.current = 0;
        };

        ws.onmessage = (event) => {
            if (!mountedRef.current) return;
            if (!(event.data instanceof ArrayBuffer)) return;

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

    // Listen for fullscreen changes
    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const handleReconnect = () => {
        reconnectCount.current = 0;
        connect();
    };

    const handleStop = async () => {
        if (!workspace) return;
        try {
            await endSession(workspace.id, sessionId);
        } catch { }
        router.push('/browser-profiles');
    };

    const toggleFullscreen = () => {
        if (!containerRef.current) return;
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            containerRef.current.requestFullscreen();
        }
    };

    return (
        <div className="-m-6 flex flex-col h-[calc(100vh-56px)]" ref={containerRef}>
            {/* Toolbar */}
            <div className="h-12 flex-shrink-0 border-b border-border bg-card flex items-center justify-between px-4">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => router.push('/browser-profiles')}
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Browser Session</span>
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                        {sessionId.slice(0, 8)}
                    </Badge>
                    <div
                        className={`h-2 w-2 rounded-full ${
                            status === 'connected'
                                ? 'bg-emerald-500'
                                : status === 'connecting'
                                  ? 'bg-amber-500 animate-pulse'
                                  : 'bg-red-500'
                        }`}
                    />
                    {frameCount > 0 && (
                        <span className="text-[10px] text-muted-foreground">{frameCount}f</span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    >
                        {isFullscreen ? (
                            <Minimize2 className="h-4 w-4" />
                        ) : (
                            <Maximize2 className="h-4 w-4" />
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs h-8 text-red-600 hover:text-red-700"
                        onClick={handleStop}
                    >
                        <Square className="h-3.5 w-3.5" />
                        Stop Session
                    </Button>
                </div>
            </div>

            {/* Full-page preview */}
            <div className="flex-1 relative bg-black min-h-0">
                <img
                    ref={imgRef}
                    alt="Browser session preview"
                    className="absolute inset-0 w-full h-full object-contain"
                    draggable={false}
                />

                {status === 'connecting' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Connecting to browser session...</span>
                        </div>
                    </div>
                )}

                {status === 'disconnected' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                        <div className="flex flex-col items-center gap-4">
                            <WifiOff className="h-8 w-8 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Connection lost</span>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={handleReconnect}>
                                    Reconnect
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => router.push('/browser-profiles')}>
                                    Back to Profiles
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
