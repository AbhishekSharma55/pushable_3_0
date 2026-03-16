import os
import asyncio
import logging

import aiohttp

logger = logging.getLogger("captcha.capsolver")


class CapsolverError(Exception):
    pass


class CapsolverClient:
    """Async client for the Capsolver API."""

    def __init__(self) -> None:
        self.api_key = os.getenv("CAPSOLVER_API_KEY", "")
        self.base_url = "https://api.capsolver.com"

    async def _create_task(self, task: dict) -> str:
        """Create a task and return the task ID."""
        payload = {"clientKey": self.api_key, "task": task}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/createTask",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()

        if data.get("errorId", 0) != 0:
            raise CapsolverError(data.get("errorDescription", "Unknown Capsolver error"))

        task_id = data.get("taskId")
        if not task_id:
            # Some tasks return the solution directly (instant solve)
            solution = data.get("solution", {})
            token = solution.get("gRecaptchaResponse") or solution.get("token") or solution.get("text")
            if token:
                return token
            raise CapsolverError("No taskId or instant solution returned")

        return await self._poll_result(task_id)

    async def _poll_result(self, task_id: str, timeout: float = 120, interval: float = 3) -> str:
        """Poll for task result until ready or timeout."""
        payload = {"clientKey": self.api_key, "taskId": task_id}
        elapsed = 0.0

        while elapsed < timeout:
            await asyncio.sleep(interval)
            elapsed += interval

            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/getTaskResult",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    data = await resp.json()

            if data.get("errorId", 0) != 0:
                raise CapsolverError(data.get("errorDescription", "Unknown error"))

            status = data.get("status", "")
            if status == "ready":
                solution = data.get("solution", {})
                token = (
                    solution.get("gRecaptchaResponse")
                    or solution.get("token")
                    or solution.get("text")
                    or ""
                )
                if token:
                    return token
                raise CapsolverError("Task ready but no token in solution")
            elif status == "failed":
                raise CapsolverError(f"Task failed: {data.get('errorDescription', 'unknown')}")

            logger.debug("Task %s still processing (%.0fs elapsed)", task_id, elapsed)

        raise CapsolverError(f"Task {task_id} timed out after {timeout}s")

    async def solve_recaptcha_v2(
        self, website_url: str, website_key: str, is_invisible: bool = False
    ) -> str:
        logger.info("Solving reCAPTCHA v2 for %s (invisible=%s)", website_url, is_invisible)
        task = {
            "type": "ReCaptchaV2TaskProxyLess",
            "websiteURL": website_url,
            "websiteKey": website_key,
            "isInvisible": is_invisible,
        }
        return await self._create_task(task)

    async def solve_recaptcha_v3(
        self, website_url: str, website_key: str, page_action: str = "verify"
    ) -> str:
        logger.info("Solving reCAPTCHA v3 for %s (action=%s)", website_url, page_action)
        task = {
            "type": "ReCaptchaV3TaskProxyLess",
            "websiteURL": website_url,
            "websiteKey": website_key,
            "pageAction": page_action,
        }
        return await self._create_task(task)

    async def solve_hcaptcha(self, website_url: str, website_key: str) -> str:
        logger.info("Solving hCaptcha for %s", website_url)
        task = {
            "type": "HCaptchaTaskProxyLess",
            "websiteURL": website_url,
            "websiteKey": website_key,
        }
        return await self._create_task(task)

    async def solve_turnstile(self, website_url: str, website_key: str) -> str:
        logger.info("Solving Turnstile for %s", website_url)
        task = {
            "type": "AntiTurnstileTaskProxyLess",
            "websiteURL": website_url,
            "websiteKey": website_key,
        }
        return await self._create_task(task)

    async def get_balance(self) -> float:
        payload = {"clientKey": self.api_key}
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/getBalance",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()

        if data.get("errorId", 0) != 0:
            raise CapsolverError(data.get("errorDescription", "Unknown error"))

        return float(data.get("balance", 0))


capsolver_client = CapsolverClient()
