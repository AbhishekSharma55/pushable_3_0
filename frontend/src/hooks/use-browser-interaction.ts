import { useCallback, useEffect, useRef, useState } from 'react';

const MOUSE_THROTTLE_MS = 50;

interface Coords {
    x: number;
    y: number;
}

interface UseBrowserInteractionOptions {
    wsRef: React.RefObject<WebSocket | null>;
    imgRef: React.RefObject<HTMLImageElement | null>;
    containerRef: React.RefObject<HTMLElement | null>;
    enabled?: boolean;
}

/**
 * Computes where the image is rendered inside a container using object-contain,
 * then maps a mouse event's position to the image's natural (viewport) coordinates.
 */
function mapMouseToViewport(
    clientX: number,
    clientY: number,
    container: HTMLElement,
    img: HTMLImageElement,
): Coords | null {
    if (!img.naturalWidth || !img.naturalHeight) return null;

    const rect = container.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const cW = rect.width;
    const cH = rect.height;
    const nW = img.naturalWidth;
    const nH = img.naturalHeight;

    const containerAspect = cW / cH;
    const imgAspect = nW / nH;

    let rW: number, rH: number, oX: number, oY: number;

    if (containerAspect > imgAspect) {
        // Container is wider — image fills height, centered horizontally
        rH = cH;
        rW = cH * imgAspect;
        oX = (cW - rW) / 2;
        oY = 0;
    } else {
        // Container is taller — image fills width, centered vertically
        rW = cW;
        rH = cW / imgAspect;
        oX = 0;
        oY = (cH - rH) / 2;
    }

    const relX = (mouseX - oX) / rW;
    const relY = (mouseY - oY) / rH;

    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

    return {
        x: Math.round(relX * nW),
        y: Math.round(relY * nH),
    };
}

export function useBrowserInteraction({
    wsRef,
    imgRef,
    containerRef,
    enabled = true,
}: UseBrowserInteractionOptions) {
    const [isFocused, setIsFocused] = useState(false);
    const [cursorPos, setCursorPos] = useState<Coords | null>(null);
    const lastMoveRef = useRef(0);

    // ── helpers ──

    const sendEvent = useCallback(
        (event: Record<string, unknown>) => {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
            }
        },
        [wsRef],
    );

    const getCoords = useCallback(
        (e: { clientX: number; clientY: number }): Coords | null => {
            const container = containerRef.current;
            const img = imgRef.current;
            if (!container || !img) return null;
            return mapMouseToViewport(e.clientX, e.clientY, container, img);
        },
        [containerRef, imgRef],
    );

    // ── mouse handlers ──

    const onMouseDown = useCallback(
        (e: React.MouseEvent<HTMLElement>) => {
            if (!enabled) return;
            const coords = getCoords(e);
            if (!coords) return;
            sendEvent({ type: 'mousedown', ...coords, button: e.button });
        },
        [enabled, getCoords, sendEvent],
    );

    const onMouseUp = useCallback(
        (e: React.MouseEvent<HTMLElement>) => {
            if (!enabled) return;
            const coords = getCoords(e);
            if (!coords) return;
            sendEvent({ type: 'mouseup', ...coords, button: e.button });
        },
        [enabled, getCoords, sendEvent],
    );

    const onMouseMove = useCallback(
        (e: React.MouseEvent<HTMLElement>) => {
            if (!enabled) return;

            // Always update the visual cursor position
            const container = containerRef.current;
            if (container) {
                const rect = container.getBoundingClientRect();
                setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }

            // Only send move events when focused (avoid phantom movement)
            if (!isFocused) return;

            // Throttle WebSocket sends
            const now = Date.now();
            if (now - lastMoveRef.current < MOUSE_THROTTLE_MS) return;
            lastMoveRef.current = now;

            const coords = getCoords(e);
            if (!coords) return;
            sendEvent({ type: 'mousemove', ...coords });
        },
        [enabled, isFocused, getCoords, sendEvent, containerRef],
    );

    const onMouseLeave = useCallback(() => {
        setCursorPos(null);
    }, []);

    const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
        e.preventDefault();
    }, []);

    // ── keyboard handlers ──

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLElement>) => {
            if (!enabled || !isFocused) return;
            e.preventDefault();
            sendEvent({ type: 'keydown', key: e.key });
        },
        [enabled, isFocused, sendEvent],
    );

    const onKeyUp = useCallback(
        (e: React.KeyboardEvent<HTMLElement>) => {
            if (!enabled || !isFocused) return;
            e.preventDefault();
            sendEvent({ type: 'keyup', key: e.key });
        },
        [enabled, isFocused, sendEvent],
    );

    // ── scroll (wheel) — must be non-passive to preventDefault ──

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !enabled) return;

        const handleWheel = (e: WheelEvent) => {
            if (!isFocused) return;
            e.preventDefault();

            const img = imgRef.current;
            if (!container || !img) return;

            const coords = mapMouseToViewport(e.clientX, e.clientY, container, img);
            if (!coords) return;

            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: 'wheel',
                        ...coords,
                        deltaX: e.deltaX,
                        deltaY: e.deltaY,
                    }),
                );
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [containerRef, imgRef, wsRef, enabled, isFocused]);

    // ── focus ──

    const onFocus = useCallback(() => setIsFocused(true), []);
    const onBlur = useCallback(() => {
        setIsFocused(false);
        setCursorPos(null);
    }, []);

    // ── public API ──

    const containerProps = {
        tabIndex: 0,
        onFocus,
        onBlur,
        onMouseDown,
        onMouseUp,
        onMouseMove,
        onMouseLeave,
        onKeyDown,
        onKeyUp,
        onContextMenu,
    };

    return { isFocused, cursorPos, containerProps };
}
