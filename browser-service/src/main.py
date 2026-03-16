import os
import logging

from dotenv import load_dotenv

load_dotenv()

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .browser_manager import browser_manager
from .routes.sessions import router as sessions_router
from .routes.actions import router as actions_router
from .ws.stream import router as ws_router
from .captcha.extension import download_capsolver_extension
from .captcha.capsolver import capsolver_client, CapsolverError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("browser_service")

CAPSOLVER_EXTENSION_ENABLED = os.getenv("CAPSOLVER_EXTENSION_ENABLED", "false").lower() == "true"


@asynccontextmanager
async def lifespan(app: FastAPI):
    profiles_dir = os.getenv("PROFILES_DIR", "./profiles")
    os.makedirs(profiles_dir, exist_ok=True)

    # Download Capsolver extension if enabled
    if CAPSOLVER_EXTENSION_ENABLED:
        logger.info("Capsolver extension enabled, downloading if needed...")
        await download_capsolver_extension()

    logger.info("Browser service started, profiles dir: %s", profiles_dir)
    yield
    logger.info("Shutting down, closing all sessions...")
    await browser_manager.close_all_sessions()
    logger.info("All sessions closed")


app = FastAPI(title="Browser Service", lifespan=lifespan)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)
app.include_router(actions_router)
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "activeSessions": len(browser_manager.active_sessions),
    }


@app.get("/api/browser/captcha/balance")
async def captcha_balance():
    try:
        balance = await capsolver_client.get_balance()
        return {"balance": balance}
    except CapsolverError as e:
        return {"balance": None, "error": str(e)}
