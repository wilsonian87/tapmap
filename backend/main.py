import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from db.database import init_db
from auth.routes import router as auth_router
from api.scans import router as scans_router
from api.exports import router as exports_router
from api.admin import router as admin_router, auto_purge_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()
    logger.info("TapMap ready.")
    purge_task = asyncio.create_task(auto_purge_loop())
    yield
    purge_task.cancel()
    logger.info("Shutting down.")


app = FastAPI(
    title="TapMap",
    description="Pharma website interaction discovery tool",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS (configurable via CORS_ORIGINS env var)
from config import settings as _settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(auth_router)
app.include_router(scans_router)
app.include_router(exports_router)
app.include_router(admin_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "tapmap"}


# Serve frontend static files in production (must be last — catch-all mount)
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
