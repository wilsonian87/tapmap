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


def _generate_scan_id(domain: str) -> str:
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"{timestamp}_{domain.replace('.', '_')}"


async def _run_scan(scan_id: str, config: ScanConfig, username: str):
    """Background task: execute the crawl and persist results."""
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

            # Determine scan quality from consent result
            scan_quality = "clean"
            consent_detected = 0
            consent_action = None
            consent_framework = None

            if engine.consent_result:
                consent_detected = 1 if engine.consent_result.detected else 0
                consent_action = engine.consent_result.action
                consent_framework = engine.consent_result.framework
                if engine.consent_result.action == "failed":
                    scan_quality = "blocked_by_consent"
                elif engine.consent_result.action == "bypass_css":
                    scan_quality = "partial_consent"

            # Count total elements across all pages
            total_elements = sum(len(p.elements) for p in pages)

            await db.execute(
                """UPDATE scans SET
                    scan_status = ?,
                    pages_scanned = ?,
                    total_pages = ?,
                    duration_seconds = ?,
                    scan_quality = ?,
                    consent_detected = ?,
                    consent_action = ?,
                    consent_framework = ?,
                    robots_txt_found = ?,
                    robots_txt_respected = ?
                WHERE scan_id = ?""",
                (
                    final_status,
                    len(pages),
                    len(pages),
                    round(duration, 2),
                    scan_quality,
                    consent_detected,
                    consent_action,
                    consent_framework,
                    1 if engine.progress.status != "blocked_by_robots" else 0,
                    1,  # We always respect robots.txt
                    scan_id,
                ),
            )

            # Store extracted elements
            for page in pages:
                for el in page.elements:
                    await db.execute(
                        """INSERT INTO elements
                            (scan_id, page_url, page_title, element_type,
                             action_type, element_text, css_selector,
                             section_context, container_context,
                             is_above_fold, target_url, is_external,
                             pharma_context, notes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            scan_id,
                            el.page_url,
                            el.page_title,
                            el.element_type,
                            el.action_type,
                            el.element_text,
                            el.css_selector,
                            el.section_context,
                            el.container_context,
                            1 if el.is_above_fold else 0,
                            el.target_url,
                            1 if el.is_external else 0,
                            el.pharma_context,
                            el.notes,
                        ),
                    )

            await db.commit()
            logger.info(
                "Scan %s completed: %d pages, %d elements in %.1fs",
                scan_id, len(pages), total_elements, duration,
            )

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
    """Get scan details including extracted elements."""
    cursor = await db.execute(
        "SELECT * FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, user["username"]),
    )
    scan = await cursor.fetchone()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    # Get all extracted elements
    cursor = await db.execute(
        """SELECT page_url, page_title, element_type, action_type,
                  element_text, css_selector, section_context,
                  container_context, is_above_fold, target_url,
                  is_external, pharma_context, notes
           FROM elements WHERE scan_id = ?
           ORDER BY id""",
        (scan_id,),
    )
    elements = await cursor.fetchall()

    # Summary stats
    element_list = [dict(e) for e in elements]
    type_counts = {}
    pharma_count = 0
    for el in element_list:
        t = el.get("element_type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
        if el.get("pharma_context"):
            pharma_count += 1

    return {
        "scan": dict(scan),
        "elements": element_list,
        "summary": {
            "total_elements": len(element_list),
            "by_type": type_counts,
            "pharma_flagged": pharma_count,
        },
    }
