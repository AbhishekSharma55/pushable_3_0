'use client';

import { useEffect, useRef, useState, useCallback, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Wifi, WifiOff, Monitor, MousePointerClick, Keyboard } from 'lucide-react';
import { getExtensionSettings } from '@/lib/api/extension';

export function ExtensionLiveView({ workspaceId }: { workspaceId: string }) {
    const [frameData, setFrameData] = useState<string | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [error, setError] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Keep track of the active tab being streamed
    const activeTabIdRef = useRef<number | null>(null);

    useEffect(() => {
        let mounted = true;

        async function init() {
            try {
                const settings = await getExtensionSettings(workspaceId);
                if (!settings || !settings.wsUrl || !settings.apiKey) {
                    if (mounted) setError('Missing extension credentials. Set them in Extension Settings.');
                    if (mounted) setStatus('disconnected');
                    return;
                }

                // Append role=frontend so the bridge accepts us
                const url = new URL(settings.wsUrl);
                url.searchParams.set('role', 'frontend');
                url.searchParams.set('key', settings.apiKey);

                const ws = new WebSocket(url.toString());
                wsRef.current = ws;

                ws.onopen = () => {
                    if (mounted) setStatus('connected');
                };

                ws.onclose = () => {
                    if (mounted) setStatus('disconnected');
                };

                ws.onerror = () => {
                    if (mounted) setError('WebSocket connection failed.');
                };

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'frame') {
                            if (mounted) setFrameData(msg.data);
                            activeTabIdRef.current = msg.tabId; // Track which tab we are viewing
                        } else if (msg.type === 'status' && msg.status === 'disconnected') {
                            if (mounted) setFrameData(null); // Clear frame if extension disconnects
                        }
                    } catch (err) {
                        // ignore parse errors
                    }
                };
            } catch (err) {
                if (mounted) setError('Failed to fetch extension settings.');
                if (mounted) setStatus('disconnected');
            }
        }

        init();

        return () => {
            mounted = false;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [workspaceId]);

    // Send a command to the extension bridge 
    const sendCommand = useCallback((action: string, params: any) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                commandId: crypto.randomUUID(),
                action,
                tabId: activeTabIdRef.current,
                ...params
            }));
        }
    }, []);

    // ─── Interaction Handlers ───
    
    // We compute relative X/Y to handle resizing. Chrome's viewport might be different, 
    // but without knowing innerWidth/innerHeight, we simulate best-effort by normalizing.
    // However, elementFromPoint uses CSS pixels. For an accurate click mapping, we simply 
    // evaluate JS to click the element at the scaled coordinates.
    const handleImageClick = useCallback((e: ReactMouseEvent<HTMLImageElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        // Calculate percentage of click relative to the image size
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;

        sendCommand('clickPoint', { x: px, y: py });
    }, [sendCommand]);

    const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
        // Prevent scrolling when using arrows inside the live view
        if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.key)) {
            e.preventDefault();
        }
        
        // Single characters or special keys
        // The background.js "keyPress" action maps these to the activeElement.
        sendCommand('keyPress', { key: e.key });
    }, [sendCommand]);

    const handleWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
        // Dispatch scroll command based on wheel delta
        // Positive Y = scroll down, Negative Y = scroll up
        sendCommand('scroll', { x: e.deltaX, y: e.deltaY });
    }, [sendCommand]);


    return (
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden h-[600px]">
            {/* Header Toolbar */}
            <div className="flex items-center justify-between border-b border-border bg-muted/20 px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-muted-foreground" />
                    <span className="font-semibold text-sm">Live Chrome View</span>
                </div>
                <div className="flex items-center gap-4 text-xs font-medium">
                    {status === 'connected' ? (
                        <div className="flex items-center gap-1.5 text-green-500">
                            <Wifi className="h-3.5 w-3.5" />
                            <span>Connected ({frameData ? 'Streaming' : 'Waiting for Extension...'})</span>
                        </div>
                    ) : status === 'connecting' ? (
                        <div className="flex items-center gap-1.5 text-yellow-500">
                            <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                            <span>Connecting...</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-destructive">
                            <WifiOff className="h-3.5 w-3.5" />
                            <span>Disconnected</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Video / Error Area */}
            <div 
                ref={containerRef}
                className="flex-1 bg-black/95 relative flex items-center justify-center outline-none focus:ring-inset focus:ring-1 focus:ring-primary/50 cursor-crosshair overflow-hidden"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onWheel={handleWheel}
            >
                {error ? (
                    <div className="text-center p-6 text-destructive space-y-2">
                        <WifiOff className="h-8 w-8 mx-auto opacity-80" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                ) : !frameData ? (
                    <div className="text-center p-6 text-muted-foreground space-y-3">
                        {status === 'connected' ? (
                            <>
                                <Monitor className="h-10 w-10 mx-auto opacity-20 animate-pulse" />
                                <p className="text-sm">Waiting for live frame stream...</p>
                                <p className="text-xs opacity-60">Ensure Chrome is open with an active tab (not a new tab page).</p>
                            </>
                        ) : (
                            <>
                                <Monitor className="h-10 w-10 mx-auto opacity-20" />
                                <p className="text-sm">Connecting to bridge...</p>
                            </>
                        )}
                    </div>
                ) : (
                    <img
                        src={frameData}
                        alt="Live Chrome View"
                        className="w-auto h-auto max-w-full max-h-full object-contain pointer-events-auto"
                        onClick={handleImageClick}
                        draggable={false}
                    />
                )}
                
                {/* Overlay Hint */}
                {frameData && (
                    <div className="absolute bottom-3 right-3 flex items-center gap-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] text-white/80 pointer-events-none border border-white/10">
                        <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3" /> Click</span>
                        <span className="flex items-center gap-1"><Keyboard className="h-3 w-3" /> Type & Scroll</span>
                    </div>
                )}
            </div>
        </div>
    );
}
