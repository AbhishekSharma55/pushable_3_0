import asyncio
import logging

from playwright.async_api import Page

from .capsolver import capsolver_client, CapsolverError
from .detector import captcha_detector

logger = logging.getLogger("captcha.solver")


class CaptchaSolver:
    """Combines CAPTCHA detection with Capsolver API solving."""

    async def solve(self, page: Page, website_url: str) -> dict:
        """
        Detect and solve any CAPTCHA on the page.
        Returns: { solved: bool, method: str, error: str | None }
        """
        try:
            detection = await captcha_detector.detect(page)
            captcha_type = detection.get("type")
            sitekey = detection.get("sitekey")
            details = detection.get("details", {})

            if captcha_type is None:
                return {"solved": True, "method": "none_needed", "error": None}

            logger.info("Attempting to solve CAPTCHA: type=%s, url=%s", captcha_type, website_url)

            if captcha_type == "recaptcha_v2":
                return await self._solve_recaptcha_v2(page, website_url, sitekey, details)

            elif captcha_type == "recaptcha_v3":
                return await self._solve_recaptcha_v3(page, website_url, sitekey)

            elif captcha_type == "hcaptcha":
                return await self._solve_hcaptcha(page, website_url, sitekey)

            elif captcha_type == "turnstile":
                return await self._solve_turnstile(page, website_url, sitekey)

            elif captcha_type == "cloudflare_challenge":
                return await self._handle_cloudflare_challenge(page)

            else:
                return {"solved": False, "method": captcha_type, "error": f"Unsupported CAPTCHA type: {captcha_type}"}

        except Exception as e:
            logger.error("CAPTCHA solve failed: %s", e)
            return {"solved": False, "method": "unknown", "error": str(e)}

    async def _solve_recaptcha_v2(self, page: Page, url: str, sitekey: str, details: dict) -> dict:
        is_invisible = details.get("is_invisible", False)
        try:
            token = await capsolver_client.solve_recaptcha_v2(url, sitekey, is_invisible)
            await self._inject_recaptcha_token(page, token)
            logger.info("reCAPTCHA v2 solved successfully")
            return {"solved": True, "method": "recaptcha_v2", "error": None}
        except CapsolverError as e:
            logger.warning("reCAPTCHA v2 solve failed: %s", e)
            return {"solved": False, "method": "recaptcha_v2", "error": str(e)}

    async def _solve_recaptcha_v3(self, page: Page, url: str, sitekey: str) -> dict:
        try:
            token = await capsolver_client.solve_recaptcha_v3(url, sitekey)
            await self._inject_recaptcha_token(page, token)
            logger.info("reCAPTCHA v3 solved successfully")
            return {"solved": True, "method": "recaptcha_v3", "error": None}
        except CapsolverError as e:
            logger.warning("reCAPTCHA v3 solve failed: %s", e)
            return {"solved": False, "method": "recaptcha_v3", "error": str(e)}

    async def _solve_hcaptcha(self, page: Page, url: str, sitekey: str) -> dict:
        try:
            token = await capsolver_client.solve_hcaptcha(url, sitekey)
            await page.evaluate(f"""() => {{
                const textarea = document.querySelector('textarea[name="h-captcha-response"]');
                if (textarea) {{
                    textarea.innerHTML = {repr(token)};
                    textarea.value = {repr(token)};
                }}
                // Trigger hcaptcha callback
                if (typeof window.hcaptcha !== 'undefined') {{
                    try {{ window.hcaptcha.execute(); }} catch(e) {{}}
                }}
            }}""")
            await asyncio.sleep(1)
            logger.info("hCaptcha solved successfully")
            return {"solved": True, "method": "hcaptcha", "error": None}
        except CapsolverError as e:
            logger.warning("hCaptcha solve failed: %s", e)
            return {"solved": False, "method": "hcaptcha", "error": str(e)}

    async def _solve_turnstile(self, page: Page, url: str, sitekey: str) -> dict:
        try:
            token = await capsolver_client.solve_turnstile(url, sitekey)
            await page.evaluate(f"""() => {{
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                if (input) {{
                    input.value = {repr(token)};
                    input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                // Try triggering turnstile callback
                const cb = document.querySelector('.cf-turnstile');
                if (cb && cb.dataset.callback && typeof window[cb.dataset.callback] === 'function') {{
                    window[cb.dataset.callback]({repr(token)});
                }}
            }}""")
            await asyncio.sleep(1)
            logger.info("Turnstile solved successfully")
            return {"solved": True, "method": "turnstile", "error": None}
        except CapsolverError as e:
            logger.warning("Turnstile solve failed: %s", e)
            return {"solved": False, "method": "turnstile", "error": str(e)}

    async def _handle_cloudflare_challenge(self, page: Page) -> dict:
        """Camoufox usually handles CF challenges natively. Wait and check."""
        logger.info("Waiting for Cloudflare challenge to resolve (Camoufox native)...")
        for _ in range(10):
            await asyncio.sleep(1)
            is_resolved = await page.evaluate("""() => {
                return !document.title.includes('Just a moment')
                    && !document.getElementById('challenge-running');
            }""")
            if is_resolved:
                logger.info("Cloudflare challenge resolved")
                return {"solved": True, "method": "cloudflare_challenge", "error": None}

        return {"solved": False, "method": "cloudflare_challenge", "error": "Challenge did not resolve within 10 seconds"}

    async def _inject_recaptcha_token(self, page: Page, token: str) -> None:
        """Inject reCAPTCHA token and trigger callback."""
        await page.evaluate(f"""() => {{
            // Set token in response textarea
            const el = document.getElementById('g-recaptcha-response');
            if (el) {{
                el.innerHTML = {repr(token)};
                el.value = {repr(token)};
                el.style.display = 'block';
            }}
            // Also set in any hidden textareas
            document.querySelectorAll('textarea[name="g-recaptcha-response"]').forEach(ta => {{
                ta.innerHTML = {repr(token)};
                ta.value = {repr(token)};
            }});
            // Trigger callback
            if (typeof ___grecaptcha_cfg !== 'undefined') {{
                const keys = Object.keys(___grecaptcha_cfg.clients || {{}});
                for (const key of keys) {{
                    const client = ___grecaptcha_cfg.clients[key];
                    const cb = client && Object.values(client).find(v =>
                        v && typeof v === 'object' && typeof v.callback === 'function'
                    );
                    if (cb) {{ cb.callback({repr(token)}); break; }}
                }}
            }}
        }}""")
        await asyncio.sleep(1)


captcha_solver = CaptchaSolver()
