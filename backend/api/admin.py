import asyncio
import logging
import os
from datetime import datetime, timedelta

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional

from db.database import get_db
from auth.security import get_current_user
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# --- Auth dependency ---

async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not settings.admin_username or user["username"] != settings.admin_username:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# --- Pydantic models ---

class AdminSettingsUpdate(BaseModel):
    max_pages_limit: int = Field(ge=1, le=10000)
    max_depth_limit: int = Field(ge=1, le=100)
    rate_limit_floor: float = Field(ge=0.1, le=10.0)
    rate_limit_ceiling: float = Field(ge=0.1, le=10.0)
    scan_timeout_seconds: int = Field(ge=60, le=7200)
    auto_purge_enabled: bool = False
    auto_purge_days: int = Field(ge=1, le=3650)


class PurgeRequest(BaseModel):
    days: int = Field(ge=1, le=3650)


# --- Settings endpoints ---

@router.get("/settings")
async def get_settings(
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT * FROM admin_settings WHERE id = 1")
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="Admin settings not initialized")
    return dict(row)


@router.put("/settings")
async def update_settings(
    body: AdminSettingsUpdate,
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    if body.rate_limit_floor > body.rate_limit_ceiling:
        raise HTTPException(
            status_code=422,
            detail="Rate limit floor cannot exceed ceiling",
        )
    await db.execute(
        """UPDATE admin_settings SET
            max_pages_limit = ?,
            max_depth_limit = ?,
            rate_limit_floor = ?,
            rate_limit_ceiling = ?,
            scan_timeout_seconds = ?,
            auto_purge_enabled = ?,
            auto_purge_days = ?,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ?
        WHERE id = 1""",
        (
            body.max_pages_limit,
            body.max_depth_limit,
            body.rate_limit_floor,
            body.rate_limit_ceiling,
            body.scan_timeout_seconds,
            1 if body.auto_purge_enabled else 0,
            body.auto_purge_days,
            admin["username"],
        ),
    )
    await db.commit()
    return {"message": "Settings updated"}


# --- User management ---

@router.get("/users")
async def list_users(
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """SELECT u.id, u.username, u.created_at, u.last_login,
                  COALESCE(s.scan_count, 0) as scan_count
           FROM users u
           LEFT JOIN (
               SELECT created_by, COUNT(*) as scan_count
               FROM scans GROUP BY created_by
           ) s ON s.created_by = u.username
           ORDER BY u.created_at DESC"""
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Fetch target user
    cursor = await db.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent self-delete
    if target["username"] == admin["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()
    return {"message": f"User '{target['username']}' deleted"}


# --- Scan management ---

@router.get("/scans")
async def list_all_scans(
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute(
        """SELECT scan_id, domain, scan_url, scan_status, pages_scanned,
                  total_pages, crawl_date, duration_seconds, created_by
           FROM scans
           ORDER BY crawl_date DESC"""
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


@router.delete("/scans/{scan_id}")
async def delete_scan(
    scan_id: str,
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cursor = await db.execute("SELECT scan_id FROM scans WHERE scan_id = ?", (scan_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Scan not found")

    await db.execute("DELETE FROM elements WHERE scan_id = ?", (scan_id,))
    await db.execute("DELETE FROM scans WHERE scan_id = ?", (scan_id,))
    await db.commit()
    return {"message": "Scan deleted"}


# --- Purge ---

@router.post("/purge")
async def manual_purge(
    body: PurgeRequest,
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    cutoff = (datetime.utcnow() - timedelta(days=body.days)).isoformat()
    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM scans WHERE crawl_date < ?", (cutoff,)
    )
    count = (await cursor.fetchone())["cnt"]

    await db.execute(
        "DELETE FROM elements WHERE scan_id IN (SELECT scan_id FROM scans WHERE crawl_date < ?)",
        (cutoff,),
    )
    await db.execute("DELETE FROM scans WHERE crawl_date < ?", (cutoff,))
    await db.execute(
        "UPDATE admin_settings SET last_purge_run = CURRENT_TIMESTAMP WHERE id = 1"
    )
    await db.commit()
    return {"message": f"Purged {count} scans older than {body.days} days"}


# --- Stats ---

@router.get("/stats")
async def get_stats(
    admin: dict = Depends(require_admin),
    db: aiosqlite.Connection = Depends(get_db),
):
    users = (await (await db.execute("SELECT COUNT(*) FROM users")).fetchone())[0]
    scans = (await (await db.execute("SELECT COUNT(*) FROM scans")).fetchone())[0]
    elements = (await (await db.execute("SELECT COUNT(*) FROM elements")).fetchone())[0]
    oldest_row = await (
        await db.execute("SELECT MIN(crawl_date) FROM scans")
    ).fetchone()
    oldest_scan = oldest_row[0] if oldest_row else None

    # DB file size
    db_path = settings.database_url
    try:
        db_size = os.path.getsize(db_path)
    except OSError:
        db_size = 0

    return {
        "total_users": users,
        "total_scans": scans,
        "total_elements": elements,
        "db_size_bytes": db_size,
        "oldest_scan_date": oldest_scan,
    }


# --- Auto-purge background loop ---

async def auto_purge_loop():
    """Daily check: purge scans older than configured threshold."""
    await asyncio.sleep(60)  # Initial delay after startup
    while True:
        try:
            db_path = settings.database_url
            async with aiosqlite.connect(db_path) as db:
                db.row_factory = aiosqlite.Row
                row = await (
                    await db.execute(
                        "SELECT auto_purge_enabled, auto_purge_days FROM admin_settings WHERE id = 1"
                    )
                ).fetchone()
                if row and row["auto_purge_enabled"]:
                    days = row["auto_purge_days"]
                    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
                    await db.execute(
                        "DELETE FROM elements WHERE scan_id IN (SELECT scan_id FROM scans WHERE crawl_date < ?)",
                        (cutoff,),
                    )
                    await db.execute(
                        "DELETE FROM scans WHERE crawl_date < ?", (cutoff,)
                    )
                    await db.execute(
                        "UPDATE admin_settings SET last_purge_run = CURRENT_TIMESTAMP WHERE id = 1"
                    )
                    await db.commit()
                    logger.info("Auto-purge completed: removed scans older than %d days", days)
        except Exception as e:
            logger.error("Auto-purge error: %s", e)
        await asyncio.sleep(86400)  # Run daily
