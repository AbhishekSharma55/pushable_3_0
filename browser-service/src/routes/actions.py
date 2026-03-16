import asyncio
import base64
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

import os
import logging

from ..browser_manager import browser_manager

logger = logging.getLogger("actions")

CAPSOLVER_EXTENSION_ENABLED = os.getenv("CAPSOLVER_EXTENSION_ENABLED", "false").lower() == "true"

router = APIRouter(prefix="/api/browser", tags=["actions"])


class ActionRequest(BaseModel):
    sessionId: str


class NavigateRequest(ActionRequest):
    url: str


class ClickRequest(ActionRequest):
    selector: Optional[str] = None
    text: Optional[str] = None


class TypeRequest(ActionRequest):
    selector: str
    text: str
    clearFirst: bool = False


class GetTextRequest(ActionRequest):
    selector: str = "body"


class GetHtmlRequest(ActionRequest):
    selector: str = "html"


class ScrollRequest(ActionRequest):
    direction: str = "down"
    amount: int = 500


class WaitForRequest(ActionRequest):
    selector: str
    timeout: int = 10000


class ExecuteJsRequest(ActionRequest):
    script: str


class KeyboardRequest(ActionRequest):
    key: str


def _ok(result=None):
    return {"success": True, "result": result, "error": None}


def _err(message: str):
    return {"success": False, "result": None, "error": message}


@router.post("/navigate")
async def navigate(req: NavigateRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        response = await page.goto(req.url, wait_until="domcontentloaded", timeout=30000)
        status = response.status if response else None

        # Wait for page to settle, then check for CAPTCHA/challenge pages
        await asyncio.sleep(2)

        # Check if we landed on a Cloudflare challenge or CAPTCHA page
        # and wait for it to resolve (extension or Camoufox handles it)
        for attempt in range(12):  # up to ~12 seconds
            page_title = await page.title()
            is_challenge = await page.evaluate("""() => {
                if (document.title.includes('Just a moment')) return true;
                if (document.getElementById('challenge-running')) return true;
                if (document.getElementById('challenge-stage')) return true;
                if (document.querySelector('.g-recaptcha')) return true;
                if (document.querySelector('.h-captcha')) return true;
                if (document.querySelector('.cf-turnstile')) return true;
                return false;
            }""")

            if not is_challenge:
                break

            if attempt == 0:
                logger.info("CAPTCHA/challenge detected on %s, waiting for auto-solve...", req.url)

            # If extension is disabled, try API solve on first detection
            if not CAPSOLVER_EXTENSION_ENABLED and attempt == 0:
                await browser_manager.auto_solve_captcha(req.sessionId)

            await asyncio.sleep(1)

        title = await page.title()
        url = page.url
        return _ok({"title": title, "url": url, "status": status})
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Navigation failed: {e}")


@router.post("/screenshot")
async def screenshot(req: ActionRequest):
    try:
        data = await browser_manager.get_screenshot(req.sessionId)
        b64 = base64.b64encode(data).decode("utf-8")
        return _ok({"base64": b64, "format": "jpeg"})
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Screenshot failed: {e}")


@router.post("/click")
async def click(req: ClickRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        if req.text:
            await page.get_by_text(req.text).first.click()
        elif req.selector:
            await page.click(req.selector)
        else:
            return _err("Either 'selector' or 'text' is required")
        await asyncio.sleep(1)

        # Wait for any CAPTCHA/challenge that appears after click
        for attempt in range(10):
            is_challenge = await page.evaluate("""() => {
                if (document.title.includes('Just a moment')) return true;
                if (document.getElementById('challenge-running')) return true;
                if (document.querySelector('.g-recaptcha')) return true;
                if (document.querySelector('.h-captcha')) return true;
                if (document.querySelector('.cf-turnstile')) return true;
                return false;
            }""")
            if not is_challenge:
                break
            if attempt == 0:
                logger.info("CAPTCHA detected after click, waiting for auto-solve...")
            await asyncio.sleep(1)

        return _ok("Clicked successfully")
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Click failed: {e}")


@router.post("/type")
async def type_text(req: TypeRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        if req.clearFirst:
            await page.click(req.selector, click_count=3)
            await page.keyboard.press("Backspace")
        await page.type(req.selector, req.text, delay=50)
        return _ok("Typed successfully")
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Type failed: {e}")


@router.post("/get_text")
async def get_text(req: GetTextRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        text = await page.inner_text(req.selector)
        return _ok(text[:8000])
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Get text failed: {e}")


@router.post("/get_html")
async def get_html(req: GetHtmlRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        html = await page.inner_html(req.selector)
        return _ok(html[:15000])
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Get HTML failed: {e}")


@router.post("/scroll")
async def scroll(req: ScrollRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        direction_map = {
            "down": f"window.scrollBy(0, {req.amount})",
            "up": f"window.scrollBy(0, -{req.amount})",
            "right": f"window.scrollBy({req.amount}, 0)",
            "left": f"window.scrollBy(-{req.amount}, 0)",
        }
        script = direction_map.get(req.direction)
        if not script:
            return _err(f"Invalid direction: {req.direction}")
        await page.evaluate(script)
        return _ok("Scrolled successfully")
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Scroll failed: {e}")


@router.post("/wait_for")
async def wait_for(req: WaitForRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        await page.wait_for_selector(req.selector, timeout=req.timeout)
        return _ok(f"Element '{req.selector}' found")
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Wait failed: {e}")


@router.post("/execute_js")
async def execute_js(req: ExecuteJsRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        result = await page.evaluate(req.script)
        return _ok(result)
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"JS execution failed: {e}")


@router.post("/get_url")
async def get_url(req: ActionRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        return _ok({"url": page.url, "title": await page.title()})
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Get URL failed: {e}")


@router.post("/go_back")
async def go_back(req: ActionRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        await page.go_back()
        return _ok({"url": page.url, "title": await page.title()})
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Go back failed: {e}")


@router.post("/keyboard")
async def keyboard(req: KeyboardRequest):
    try:
        page = browser_manager.get_page(req.sessionId)
        await page.keyboard.press(req.key)
        return _ok(f"Pressed '{req.key}'")
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"Keyboard press failed: {e}")


@router.post("/solve_captcha")
async def solve_captcha(req: ActionRequest):
    try:
        result = await browser_manager.auto_solve_captcha(req.sessionId)
        return {
            "success": result.get("solved", False),
            "result": result,
            "error": result.get("error"),
        }
    except KeyError as e:
        return _err(str(e))
    except Exception as e:
        return _err(f"CAPTCHA solve failed: {e}")
