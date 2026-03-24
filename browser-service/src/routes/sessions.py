import os
import logging
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..browser_manager import browser_manager
from ..session_store import session_store

logger = logging.getLogger("sessions")

router = APIRouter(prefix="/api/browser", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    sessionId: str
    workspaceId: str
    profileId: str
    headless: bool = True
    proxyUrl: Optional[str] = None


class CreateSessionResponse(BaseModel):
    sessionId: str
    status: str
    wsUrl: str


@router.post("/sessions", response_model=CreateSessionResponse)
async def create_session(req: CreateSessionRequest):
    try:
        result = await browser_manager.create_session(
            session_id=req.sessionId,
            workspace_id=req.workspaceId,
            profile_id=req.profileId,
            headless=req.headless,
            proxy_url=req.proxyUrl,
        )
        port = os.getenv("PORT", "8080")
        ws_url = f"ws://localhost:{port}/ws/{req.sessionId}"
        return CreateSessionResponse(
            sessionId=result["sessionId"],
            status=result["status"],
            wsUrl=ws_url,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error("Failed to create session %s: %s\n%s", req.sessionId, e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to create session: {e}")


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    await browser_manager.close_session(session_id)
    return {"success": True}


@router.get("/sessions")
async def list_sessions(workspaceId: Optional[str] = None):
    if workspaceId:
        return {"data": session_store.list_sessions(workspaceId)}
    return {"data": browser_manager.list_active_sessions()}
