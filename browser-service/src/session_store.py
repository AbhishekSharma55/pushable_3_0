from typing import Optional


class SessionStore:
    """In-memory store for active browser session metadata."""

    def __init__(self) -> None:
        self._sessions: dict[str, dict] = {}
        self._streaming: dict[str, bool] = {}

    def add_session(self, session_id: str, metadata: dict) -> None:
        self._sessions[session_id] = metadata
        self._streaming[session_id] = False

    def get_session(self, session_id: str) -> Optional[dict]:
        return self._sessions.get(session_id)

    def remove_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._streaming.pop(session_id, None)

    def list_sessions(self, workspace_id: str) -> list[dict]:
        return [
            {"sessionId": sid, **meta}
            for sid, meta in self._sessions.items()
            if meta.get("workspaceId") == workspace_id
        ]

    def is_streaming(self, session_id: str) -> bool:
        return self._streaming.get(session_id, False)

    def set_streaming(self, session_id: str, value: bool) -> None:
        if session_id in self._streaming:
            self._streaming[session_id] = value

    def all_session_ids(self) -> list[str]:
        return list(self._sessions.keys())


session_store = SessionStore()
