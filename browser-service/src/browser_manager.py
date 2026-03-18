import os
import asyncio
import logging
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Page, BrowserContext, Playwright
from camoufox.async_api import AsyncNewBrowser

from .session_store import session_store
from .captcha.extension import get_extension_path
from .captcha.solver import captcha_solver

logger = logging.getLogger("browser_manager")

CAPSOLVER_EXTENSION_ENABLED = os.getenv("CAPSOLVER_EXTENSION_ENABLED", "false").lower() == "true"
CAPSOLVER_API_KEY = os.getenv("CAPSOLVER_API_KEY", "")


class BrowserManager:
    """Manages Camoufox browser instances per session."""

    def __init__(self) -> None:
        self.active_sessions: dict[str, dict] = {}
        self.profiles_dir = os.getenv("PROFILES_DIR", "./profiles")

    async def create_session(
        self,
        session_id: str,
        workspace_id: str,
        profile_id: str,
        headless: bool = True,
        proxy_url: Optional[str] = None,
    ) -> dict:
        if session_id in self.active_sessions:
            raise ValueError(f"Session {session_id} already exists")

        # Build profile path and ensure it exists
        profile_path = Path(self.profiles_dir) / workspace_id / profile_id
        profile_path.mkdir(parents=True, exist_ok=True)

        # Remove stale Firefox lock files from previous crashed sessions
        for lock_file in ("lock", "parent.lock", ".parentlock"):
            lock_path = profile_path / lock_file
            if lock_path.exists():
                try:
                    lock_path.unlink()
                    logger.info("Removed stale lock file: %s", lock_path)
                except OSError:
                    pass

        # Build extra launch kwargs
        launch_kwargs: dict = {}

        # Load Capsolver extension if enabled
        if CAPSOLVER_EXTENSION_ENABLED:
            ext_path = get_extension_path()
            if ext_path:
                launch_kwargs["addons"] = [ext_path]
                logger.info("Loading Capsolver extension from %s", ext_path)

        # Parse proxy URL if provided
        if proxy_url:
            from urllib.parse import urlparse
            parsed = urlparse(proxy_url)
            launch_kwargs["proxy"] = {
                "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
                "username": parsed.username,
                "password": parsed.password,
            }
            logger.info("Session %s using proxy %s:%s", session_id, parsed.hostname, parsed.port)

        # Launch playwright and Camoufox
        pw: Playwright = await async_playwright().start()

        try:
            # persistent_context=True returns a BrowserContext directly
            browser_context: BrowserContext = await AsyncNewBrowser(
                pw,
                headless=headless,
                persistent_context=True,
                user_data_dir=str(profile_path),
                **launch_kwargs,
            )

            page: Page = await browser_context.new_page()
            width = int(os.getenv("SCREENSHOT_WIDTH", "1920"))
            height = int(os.getenv("SCREENSHOT_HEIGHT", "1080"))
            await page.set_viewport_size({"width": width, "height": height})
            # Navigate to Google so the browser is ready with a useful default
            await page.goto("https://www.google.com")
            await asyncio.sleep(0.3)

            # Inject Capsolver API key into extension config via localStorage
            if CAPSOLVER_EXTENSION_ENABLED and CAPSOLVER_API_KEY:
                try:
                    await page.evaluate(f"""() => {{
                        try {{
                            localStorage.setItem('capsolver_api_key', {repr(CAPSOLVER_API_KEY)});
                            window.__capsolver_api_key = {repr(CAPSOLVER_API_KEY)};
                        }} catch(e) {{}}
                    }}""")
                except Exception as e:
                    logger.warning("Failed to inject Capsolver API key: %s", e)

        except Exception:
            await pw.stop()
            raise

        session_data = {
            "browser_context": browser_context,
            "page": page,
            "playwright": pw,
            "profileId": profile_id,
            "workspaceId": workspace_id,
        }
        self.active_sessions[session_id] = session_data

        session_store.add_session(session_id, {
            "workspaceId": workspace_id,
            "profileId": profile_id,
            "status": "active",
        })

        logger.info("Session %s created for workspace %s", session_id, workspace_id)

        return {
            "sessionId": session_id,
            "status": "active",
            "workspaceId": workspace_id,
            "profileId": profile_id,
        }

    def get_session(self, session_id: str) -> dict:
        session = self.active_sessions.get(session_id)
        if not session:
            raise KeyError(f"Session {session_id} not found")
        return session

    def get_page(self, session_id: str) -> Page:
        return self.get_session(session_id)["page"]

    async def close_session(self, session_id: str) -> None:
        session = self.active_sessions.pop(session_id, None)
        if not session:
            return

        session_store.set_streaming(session_id, False)

        page: Optional[Page] = session.get("page")
        context: Optional[BrowserContext] = session.get("browser_context")
        pw: Optional[Playwright] = session.get("playwright")

        try:
            if page and not page.is_closed():
                await page.close()
        except Exception as e:
            logger.warning("Error closing page for session %s: %s", session_id, e)

        try:
            if context:
                await context.close()
        except Exception as e:
            logger.warning("Error closing context for session %s: %s", session_id, e)

        try:
            if pw:
                await pw.stop()
        except Exception as e:
            logger.warning("Error stopping playwright for session %s: %s", session_id, e)

        session_store.remove_session(session_id)
        logger.info("Session %s closed", session_id)

    async def get_screenshot(self, session_id: str) -> bytes:
        page = self.get_page(session_id)
        quality = int(os.getenv("SCREENSHOT_QUALITY", "60"))
        width = int(os.getenv("SCREENSHOT_WIDTH", "1920"))
        height = int(os.getenv("SCREENSHOT_HEIGHT", "1080"))
        return await page.screenshot(
            type="jpeg",
            quality=quality,
            full_page=False,
            clip={"x": 0, "y": 0, "width": width, "height": height},
        )

    async def auto_solve_captcha(self, session_id: str) -> dict:
        """Detect and solve any CAPTCHA on the current page."""
        page = self.get_page(session_id)
        url = page.url
        return await captcha_solver.solve(page, url)

    def list_active_sessions(self) -> list[dict]:
        return [
            {
                "sessionId": sid,
                "workspaceId": data["workspaceId"],
                "profileId": data["profileId"],
            }
            for sid, data in self.active_sessions.items()
        ]

    async def close_all_sessions(self) -> None:
        session_ids = list(self.active_sessions.keys())
        for sid in session_ids:
            try:
                await self.close_session(sid)
            except Exception as e:
                logger.error("Error closing session %s during shutdown: %s", sid, e)


browser_manager = BrowserManager()
