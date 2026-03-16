import os
import io
import zipfile
import logging
from pathlib import Path

import aiohttp

logger = logging.getLogger("captcha.extension")

EXTENSIONS_DIR = Path(__file__).resolve().parent.parent.parent / "extensions"
EXTENSION_DIR = EXTENSIONS_DIR / "capsolver"

GITHUB_API_URL = "https://api.github.com/repos/capsolver/capsolver-browser-extension/releases/latest"


async def download_capsolver_extension() -> bool:
    """Download and extract the Capsolver Firefox extension if not already present."""
    EXTENSIONS_DIR.mkdir(parents=True, exist_ok=True)

    # Check if already extracted
    manifest = EXTENSION_DIR / "manifest.json"
    if manifest.exists():
        logger.info("Capsolver extension already present at %s", EXTENSION_DIR)
        return True

    logger.info("Downloading Capsolver Firefox extension...")

    try:
        async with aiohttp.ClientSession() as session:
            # Get latest release info
            async with session.get(GITHUB_API_URL, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    logger.warning("Failed to fetch Capsolver release info: HTTP %d", resp.status)
                    return False
                release = await resp.json()

            # Find Firefox zip asset
            zip_url = None
            for asset in release.get("assets", []):
                name = asset.get("name", "").lower()
                if "firefox" in name and name.endswith(".zip"):
                    zip_url = asset["browser_download_url"]
                    break

            if not zip_url:
                logger.warning("No Firefox zip asset found in latest Capsolver release")
                return False

            # Download zip
            async with session.get(zip_url, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                if resp.status != 200:
                    logger.warning("Failed to download Capsolver extension: HTTP %d", resp.status)
                    return False
                data = await resp.read()

            # Extract zip to extensions/capsolver/
            EXTENSION_DIR.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                zf.extractall(EXTENSION_DIR)

            logger.info("Capsolver extension extracted to %s (%d bytes)", EXTENSION_DIR, len(data))

            # Inject API key into extension config if available
            api_key = os.getenv("CAPSOLVER_API_KEY", "")
            if api_key:
                _inject_api_key(api_key)

            return True

    except Exception as e:
        logger.warning("Failed to download Capsolver extension: %s", e)
        return False


def _inject_api_key(api_key: str) -> None:
    """Write API key into the extension's config file."""
    config_path = EXTENSION_DIR / "assets" / "config.js"
    if not config_path.parent.exists():
        # Try to find any config file in the extension
        for p in EXTENSION_DIR.rglob("config.js"):
            config_path = p
            break

    try:
        # Create/overwrite a simple config that the extension reads
        config_js = EXTENSION_DIR / "assets" / "config.js"
        config_js.parent.mkdir(parents=True, exist_ok=True)
        config_js.write_text(
            f'window.capsolver_config = {{ apiKey: "{api_key}" }};\n'
        )
        logger.info("Injected Capsolver API key into extension config")
    except Exception as e:
        logger.warning("Failed to inject API key into extension: %s", e)


def get_extension_path() -> str | None:
    """Return path to extracted extension directory if it exists, else None."""
    manifest = EXTENSION_DIR / "manifest.json"
    if manifest.exists():
        return str(EXTENSION_DIR)
    return None
