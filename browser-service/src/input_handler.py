import logging
from playwright.async_api import Page

logger = logging.getLogger("input_handler")

BUTTON_MAP = {0: "left", 1: "middle", 2: "right"}


async def handle_input_event(page: Page, event: dict) -> None:
    """Execute a user input event on the Playwright page."""
    event_type = event.get("type")
    if not event_type:
        return

    try:
        if event_type == "mousemove":
            await page.mouse.move(event["x"], event["y"])

        elif event_type == "mousedown":
            button = BUTTON_MAP.get(event.get("button", 0), "left")
            await page.mouse.move(event["x"], event["y"])
            await page.mouse.down(button=button)

        elif event_type == "mouseup":
            button = BUTTON_MAP.get(event.get("button", 0), "left")
            await page.mouse.up(button=button)

        elif event_type == "wheel":
            await page.mouse.move(event["x"], event["y"])
            delta_x = event.get("deltaX", 0)
            delta_y = event.get("deltaY", 0)
            await page.mouse.wheel(delta_x, delta_y)

        elif event_type == "keydown":
            key = event.get("key", "")
            if key:
                await page.keyboard.down(key)

        elif event_type == "keyup":
            key = event.get("key", "")
            if key:
                await page.keyboard.up(key)

    except Exception as e:
        # Don't crash on input errors — just log at debug level
        logger.debug("Input event error (%s): %s", event_type, e)
