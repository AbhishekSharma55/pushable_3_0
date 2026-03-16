import logging
from typing import Optional

from playwright.async_api import Page

logger = logging.getLogger("captcha.detector")


class CaptchaDetector:
    """Detect CAPTCHAs on a Playwright page."""

    async def detect(self, page: Page) -> dict:
        """
        Detect CAPTCHA type on the current page.
        Returns: { type, sitekey, details }
        """
        try:
            # 1. reCAPTCHA v2
            result = await self._detect_recaptcha_v2(page)
            if result:
                return result

            # 2. reCAPTCHA v3
            result = await self._detect_recaptcha_v3(page)
            if result:
                return result

            # 3. hCaptcha
            result = await self._detect_hcaptcha(page)
            if result:
                return result

            # 4. Cloudflare Turnstile
            result = await self._detect_turnstile(page)
            if result:
                return result

            # 5. Cloudflare challenge page
            result = await self._detect_cloudflare_challenge(page)
            if result:
                return result

        except Exception as e:
            logger.warning("Error during CAPTCHA detection: %s", e)

        return {"type": None, "sitekey": None, "details": {}}

    async def _detect_recaptcha_v2(self, page: Page) -> Optional[dict]:
        sitekey = await page.evaluate("""() => {
            const el = document.querySelector('.g-recaptcha[data-sitekey]')
                     || document.querySelector('[data-sitekey]:not(.cf-turnstile):not([data-cf-turnstile])');
            if (!el) return null;
            return {
                sitekey: el.getAttribute('data-sitekey'),
                invisible: el.getAttribute('data-size') === 'invisible'
            };
        }""")
        if sitekey and sitekey.get("sitekey"):
            is_invisible = bool(sitekey.get("invisible", False))
            logger.info("Detected reCAPTCHA v2 (invisible=%s, sitekey=%s)", is_invisible, sitekey["sitekey"][:12])
            return {
                "type": "recaptcha_v2",
                "sitekey": sitekey["sitekey"],
                "details": {"is_invisible": is_invisible},
            }
        return None

    async def _detect_recaptcha_v3(self, page: Page) -> Optional[dict]:
        sitekey = await page.evaluate("""() => {
            const script = document.querySelector('script[src*="recaptcha/api.js"], script[src*="recaptcha/enterprise.js"]');
            if (!script) return null;
            // Check if there's no visible checkbox (v3 is invisible)
            const checkbox = document.querySelector('.g-recaptcha');
            if (checkbox) return null;
            // Try to extract sitekey from script src
            const src = script.getAttribute('src') || '';
            const match = src.match(/[?&]render=([^&]+)/);
            return match ? { sitekey: match[1] } : null;
        }""")
        if sitekey and sitekey.get("sitekey") and sitekey["sitekey"] != "explicit":
            logger.info("Detected reCAPTCHA v3 (sitekey=%s)", sitekey["sitekey"][:12])
            return {
                "type": "recaptcha_v3",
                "sitekey": sitekey["sitekey"],
                "details": {},
            }
        return None

    async def _detect_hcaptcha(self, page: Page) -> Optional[dict]:
        sitekey = await page.evaluate("""() => {
            const el = document.querySelector('.h-captcha[data-sitekey]')
                     || document.querySelector('[data-hcaptcha-widget-id]');
            if (!el) return null;
            return { sitekey: el.getAttribute('data-sitekey') || '' };
        }""")
        if sitekey and sitekey.get("sitekey"):
            logger.info("Detected hCaptcha (sitekey=%s)", sitekey["sitekey"][:12])
            return {
                "type": "hcaptcha",
                "sitekey": sitekey["sitekey"],
                "details": {},
            }
        return None

    async def _detect_turnstile(self, page: Page) -> Optional[dict]:
        sitekey = await page.evaluate("""() => {
            const el = document.querySelector('.cf-turnstile[data-sitekey]')
                     || document.querySelector('[data-cf-turnstile][data-sitekey]');
            if (!el) return null;
            return { sitekey: el.getAttribute('data-sitekey') || '' };
        }""")
        if sitekey and sitekey.get("sitekey"):
            logger.info("Detected Cloudflare Turnstile (sitekey=%s)", sitekey["sitekey"][:12])
            return {
                "type": "turnstile",
                "sitekey": sitekey["sitekey"],
                "details": {},
            }
        return None

    async def _detect_cloudflare_challenge(self, page: Page) -> Optional[dict]:
        is_challenge = await page.evaluate("""() => {
            const title = document.title || '';
            if (title.includes('Just a moment')) return true;
            if (document.getElementById('challenge-running')) return true;
            if (document.getElementById('challenge-stage')) return true;
            return false;
        }""")
        if is_challenge:
            logger.info("Detected Cloudflare challenge page")
            return {
                "type": "cloudflare_challenge",
                "sitekey": None,
                "details": {},
            }
        return None


captcha_detector = CaptchaDetector()
