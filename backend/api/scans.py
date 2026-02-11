import time
import logging
from datetime import datetime
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from pydantic import BaseModel
from typing import Optional
import aiosqlite

from db.database import get_db
from auth.security import get_current_user
from crawler.models import ScanConfig
from crawler.engine import CrawlEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scans", tags=["scans"])


class ScanRequest(BaseModel):
    url: str
    max_pages: int = 200
    max_depth: int = 5
    rate_limit: float = 1.0


class ScanResponse(BaseModel):
    scan_id: str
    domain: str
    scan_url: str
    scan_status: str
    pages_scanned: int
    total_pages: Optional[int] = None
    crawl_date: Optional[str] = None
    duration_seconds: Optional[float] = None
    robots_txt_found: Optional[bool] = None
    robots_txt_respected: Optional[bool] = None
    notes: Optional[str] = None


def _generate_scan_id(domain: str) -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"{timestamp}_{domain.replace('.', '_')}"


async def _run_scan(scan_id: str, config: ScanConfig, username: str):
    """Background task: execute the crawl and persist results."""
    from db.database import get_db as _get_db

    engine = CrawlEngine(config)
    start = time.time()

    db_path = __import__("config").settings.database_url
    import aiosqlite as _aiosqlite

    async with _aiosqlite.connect(db_path) as db:
        db.row_factory = _aiosqlite.Row

        # Update status to running
        await db.execute(
            "UPDATE scans SET scan_status = ? WHERE scan_id = ?",
            ("running", scan_id),
        )
        await db.commit()

        try:
            pages = await engine.crawl(scan_id)
            duration = time.time() - start

            final_status = engine.progress.status
            if final_status == "running":
                final_status = "completed"

            await db.execute(
                """UPDATE scans SET
                    scan_status = ?,
                    pages_scanned = ?,
                    total_pages = ?,
                    duration_seconds = ?,
                    robots_txt_found = ?,
                    robots_txt_respected = ?
                WHERE scan_id = ?""",
                (
                    final_status,
                    len(pages),
                    len(pages),
                    round(duration, 2),
                    1 if engine.progress.status != "blocked_by_robots" else 0,
                    1,  # We always respect robots.txt
                    scan_id,
                ),
            )

            # Store discovered pages as elements with type 'page' for Phase 1
            for page in pages:
                if not page.error:
                    await db.execute(
                        """INSERT INTO elements
                            (scan_id, page_url, page_title, element_type, notes)
                        VALUES (?, ?, ?, 'page', ?)""",
                        (scan_id, page.url, page.title, page.error),
                    )

            await db.commit()
            logger.info("Scan %s completed: %d pages in %.1fs", scan_id, len(pages), duration)

        except Exception as e:
            logger.error("Scan %s failed: %s", scan_id, str(e))
            await db.execute(
                "UPDATE scans SET scan_status = ?, notes = ? WHERE scan_id = ?",
                ("failed", str(e), scan_id),
            )
            await db.commit()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_scan(
    body: ScanRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Trigger a new scan."""
    # Validate URL
    parsed = urlparse(body.url)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid URL. Include scheme (https://)",
        )

    domain = parsed.netloc
    scan_id = _generate_scan_id(domain)

    config = ScanConfig(
        url=body.url,
        max_pages=body.max_pages,
        max_depth=body.max_depth,
        rate_limit=body.rate_limit,
    )

    # Insert scan record
    await db.execute(
        """INSERT INTO scans
            (scan_id, domain, scan_url, scan_status, config_max_pages,
             config_max_depth, config_rate_limit, created_by)
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)""",
        (
            scan_id, domain, body.url,
            config.max_pages, config.max_depth, config.rate_limit,
            user["username"],
        ),
    )
    await db.commit()

    # Launch crawl in background
    background_tasks.add_task(_run_scan, scan_id, config, user["username"])

    return {"scan_id": scan_id, "status": "pending", "domain": domain}


@router.get("")
async def list_scans(
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """List all scans for current user."""
    cursor = await db.execute(
        """SELECT scan_id, domain, scan_url, scan_status, pages_scanned,
                  total_pages, crawl_date, duration_seconds
           FROM scans
           WHERE created_by = ?
           ORDER BY crawl_date DESC""",
        (user["username"],),
    )
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


@router.get("/{scan_id}")
async def get_scan(
    scan_id: str,
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get scan details including discovered pages."""
    cursor = await db.execute(
        "SELECT * FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, user["username"]),
    )
    scan = await cursor.fetchone()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    # Get elements (pages in Phase 1)
    cursor = await db.execute(
        """SELECT page_url, page_title, element_type, notes
           FROM elements WHERE scan_id = ?
           ORDER BY id""",
        (scan_id,),
    )
    elements = await cursor.fetchall()

    return {
        "scan": dict(scan),
        "elements": [dict(e) for e in elements],
    }
