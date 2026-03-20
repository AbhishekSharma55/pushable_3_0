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
    Mouse,
    Keyboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { useBrowserInteraction } from '@/hooks/use-browser-interaction';
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
    const canvasRef = useRef<HTMLDivElement>(null);

    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'server-restarted'>('connecting');
    const [frameCount, setFrameCount] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

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

            if (event.code === 1006) {
                setStatus('server-restarted');
                if (workspace) {
                    endSession(workspace.id, sessionId).catch(() => {});
                }
                return;
            }

            if (event.code === 1000) {
                setStatus('disconnected');
                return;
            }

            setStatus('disconnected');
            if (reconnectCount.current < 3) {
                reconnectTimer.current = setTimeout(() => {
                    if (!mountedRef.current) return;
                    reconnectCount.current++;
                    connect();
                }, 2000);
            }
        };

        ws.onerror = () => {};
    }, [wsUrl, workspace, sessionId]);

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

                    {/* Click Mode badge */}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 ml-2">
                        <Mouse className="h-3 w-3" />
                        Click Mode
                    </Badge>

                    {/* Keyboard indicator */}
                    {isFocused && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                            <Keyboard className="h-3 w-3" />
                            Keyboard Active
                        </Badge>
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

            {/* Interactive browser canvas */}
            <div
                ref={canvasRef}
                {...interactionProps}
                className="flex-1 relative bg-black min-h-0"
                style={{ outline: 'none', cursor: isFocused ? 'none' : 'default' }}
            >
                <img
                    ref={imgRef}
                    alt="Browser session preview"
                    className="absolute inset-0 w-full h-full object-contain select-none"
                    draggable={false}
                />

                {/* Custom cursor indicator */}
                {isFocused && cursorPos && (
                    <div
                        className="absolute pointer-events-none z-20"
                        style={{ left: cursorPos.x, top: cursorPos.y, transform: 'translate(-50%, -50%)' }}
                    >
                        <div className="w-5 h-5 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_0_6px_rgba(0,0,0,0.4)]" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-white/90" />
                        </div>
                    </div>
                )}

                {/* Click to interact overlay (when connected but unfocused) */}
                {!isFocused && status === 'connected' && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="bg-black/50 text-white text-sm px-5 py-2.5 rounded-xl flex items-center gap-2 backdrop-blur-sm">
                            <Mouse className="h-4 w-4" />
                            Click to interact
                        </div>
                    </div>
                )}

                {/* Keyboard active indicator (bottom-right) */}
                {isFocused && (
                    <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 pointer-events-none z-20 backdrop-blur-sm">
                        <Keyboard className="h-3.5 w-3.5" />
                        Keyboard active
                    </div>
                )}

                {status === 'connecting' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-30">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Connecting to browser session...</span>
                        </div>
                    </div>
                )}

                {status === 'server-restarted' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-30">
                        <div className="flex flex-col items-center gap-4">
                            <WifiOff className="h-8 w-8 text-muted-foreground" />
                            <span className="text-sm font-medium">Browser service restarted</span>
                            <span className="text-sm text-muted-foreground">Please start a new session.</span>
                            <Button variant="outline" size="sm" onClick={() => router.push('/browser-profiles')}>
                                Start New Session
                            </Button>
                        </div>
                    </div>
                )}

                {status === 'disconnected' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-30">
                        <div className="flex flex-col items-center gap-4">
                            <WifiOff className="h-8 w-8 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                {reconnectCount.current >= 3
                                    ? 'Could not reconnect. Start a new session.'
                                    : 'Connection lost. Reconnecting...'}
                            </span>
                            <div className="flex items-center gap-2">
                                {reconnectCount.current >= 3 ? (
                                    <Button variant="outline" size="sm" onClick={() => router.push('/browser-profiles')}>
                                        Start New Session
                                    </Button>
                                ) : (
                                    <Button variant="outline" size="sm" onClick={handleReconnect}>
                                        Reconnect
                                    </Button>
                                )}
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
