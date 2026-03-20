import os
import json
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..browser_manager import browser_manager
from ..session_store import session_store
from ..input_handler import handle_input_event

logger = logging.getLogger("ws_stream")

router = APIRouter(tags=["websocket"])

INTERVAL_MS = int(os.getenv("SCREENSHOT_INTERVAL_MS", "200"))
PING_INTERVAL_S = 10  # Send ping every 10 seconds to keep connection alive

# Track active WebSocket per session to prevent duplicate streams
_active_ws: dict[str, WebSocket] = {}


async def _receive_input(websocket: WebSocket, session_id: str, last_pong: dict) -> None:
    """Background task: receive JSON control events from the client and
    execute them on the Playwright page via the input handler."""
    try:
        while True:
            try:
                raw = await websocket.receive()
            except Exception:
                break

            # Starlette returns a dict; check for disconnect
            if raw.get("type") == "websocket.disconnect":
                break

            text = raw.get("text")
            if not text:
                continue

            try:
                event = json.loads(text)
            except json.JSONDecodeError:
                continue

            # Handle pong responses from client
            if event.get("type") == "pong":
                last_pong["time"] = asyncio.get_event_loop().time()
                continue

            try:
                page = browser_manager.get_page(session_id)
                await handle_input_event(page, event)
            except KeyError:
                # Session was closed
                break
            except Exception as e:
                logger.debug("Input handling error for %s: %s", session_id, e)
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _send_pings(websocket: WebSocket, session_id: str) -> None:
    """Background task: send periodic ping messages to keep the connection alive."""
    try:
        while True:
            await asyncio.sleep(PING_INTERVAL_S)
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            if _active_ws.get(session_id) is not websocket:
                break
            try:
                await websocket.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break
    except asyncio.CancelledError:
        pass


@router.websocket("/ws/{session_id}")
async def stream_screenshots(websocket: WebSocket, session_id: str):
    await websocket.accept()

    # Validate session exists
    if session_id not in browser_manager.active_sessions:
        await websocket.close(code=4004, reason="Session not found")
        return

    # If there's already an active WS for this session, close the old one
    old_ws = _active_ws.get(session_id)
    if old_ws is not None:
        logger.info("Replacing existing WS for session %s", session_id)
        try:
            await old_ws.close(code=1000, reason="Replaced by new connection")
        except Exception:
            pass

    _active_ws[session_id] = websocket
    session_store.set_streaming(session_id, True)
    logger.info("WebSocket streaming started for session %s", session_id)

    interval = INTERVAL_MS / 1000.0

    # Give the browser a moment to be fully ready
    await asyncio.sleep(1.0)

    # Track last pong for health checking
    last_pong = {"time": asyncio.get_event_loop().time()}

    # Start background tasks
    input_task = asyncio.create_task(_receive_input(websocket, session_id, last_pong))
    ping_task = asyncio.create_task(_send_pings(websocket, session_id))

    frame_count = 0
    consecutive_errors = 0
    try:
        while True:
            # Check we're still the active WS for this session
            if _active_ws.get(session_id) is not websocket:
                logger.info("WS replaced for session %s, exiting loop", session_id)
                break
            # Check session still exists
            if session_id not in browser_manager.active_sessions:
                logger.info("Session %s no longer active, exiting loop", session_id)
                break
            # Check WebSocket is still open
            if websocket.client_state != WebSocketState.CONNECTED:
                logger.info("WS not connected for session %s (state=%s), exiting", session_id, websocket.client_state)
                break

            try:
                screenshot_bytes = await browser_manager.get_screenshot(session_id)
                await websocket.send_bytes(screenshot_bytes)
                frame_count += 1
                consecutive_errors = 0  # Reset on success
                if frame_count <= 3 or frame_count % 50 == 0:
                    logger.info("Sent frame %d for session %s (%d bytes)", frame_count, session_id, len(screenshot_bytes))
            except KeyError:
                logger.info("Session %s closed during screenshot, exiting", session_id)
                break
            except Exception as e:
                err_msg = str(e).lower()
                consecutive_errors += 1
                # Only break on definitive connection errors, not transient failures
                if "close" in err_msg or "disconnect" in err_msg:
                    logger.info("Connection closed for session %s (frame %d): %s", session_id, frame_count, err_msg)
                    break
                # After 5 consecutive errors, give up
                if consecutive_errors >= 5:
                    logger.warning("Too many consecutive errors for session %s (frame %d), exiting", session_id, frame_count)
                    break
                logger.debug("Transient stream error for session %s (frame %d, attempt %d): %r", session_id, frame_count, consecutive_errors, e)

            await asyncio.sleep(interval)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for session %s after %d frames", session_id, frame_count)
    except Exception as e:
        logger.error("WebSocket error for session %s: %s", session_id, e)
    finally:
        # Cancel background tasks
        input_task.cancel()
        ping_task.cancel()
        try:
            await input_task
        except asyncio.CancelledError:
            pass
        try:
            await ping_task
        except asyncio.CancelledError:
            pass

        # Only clean up if we're still the active WS
        if _active_ws.get(session_id) is websocket:
            _active_ws.pop(session_id, None)
            session_store.set_streaming(session_id, False)
        logger.info("Streaming stopped for session %s (sent %d frames)", session_id, frame_count)
