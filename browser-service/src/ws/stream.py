import os
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..browser_manager import browser_manager
from ..session_store import session_store

logger = logging.getLogger("ws_stream")

router = APIRouter(tags=["websocket"])

INTERVAL_MS = int(os.getenv("SCREENSHOT_INTERVAL_MS", "200"))

# Track active WebSocket per session to prevent duplicate streams
_active_ws: dict[str, WebSocket] = {}


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

    try:
        frame_count = 0
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
                if frame_count <= 3 or frame_count % 50 == 0:
                    logger.info("Sent frame %d for session %s (%d bytes)", frame_count, session_id, len(screenshot_bytes))
            except KeyError:
                logger.info("Session %s closed during screenshot, exiting", session_id)
                break
            except Exception as e:
                err_msg = str(e).lower()
                logger.warning("Stream error for session %s (frame %d): %r", session_id, frame_count, e)
                if "close" in err_msg or "disconnect" in err_msg or "send" in err_msg or err_msg == "":
                    break

            await asyncio.sleep(interval)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for session %s after %d frames", session_id, frame_count)
    except Exception as e:
        logger.error("WebSocket error for session %s: %s", session_id, e)
    finally:
        # Only clean up if we're still the active WS
        if _active_ws.get(session_id) is websocket:
            _active_ws.pop(session_id, None)
            session_store.set_streaming(session_id, False)
        logger.info("Streaming stopped for session %s (sent %d frames)", session_id, frame_count if 'frame_count' in dir() else 0)
