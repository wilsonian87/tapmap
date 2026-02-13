"""Export endpoints for downloading scan results."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
import aiosqlite

from db.database import get_db
from auth.security import get_current_user
from export.xlsx import generate_xlsx
from export.csv_export import generate_csv

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/exports", tags=["exports"])


async def _get_scan_data(
    scan_id: str, username: str, db: aiosqlite.Connection, dedup: bool = False
) -> tuple[dict, list[dict]]:
    """Fetch scan info and elements for export."""
    cursor = await db.execute(
        "SELECT * FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, username),
    )
    scan = await cursor.fetchone()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    if dedup:
        cursor = await db.execute(
            """SELECT
                  MIN(page_url) as page_url,
                  MIN(page_title) as page_title,
                  element_type, action_type,
                  element_text, css_selector, section_context,
                  MIN(container_context) as container_context,
                  MAX(is_above_fold) as is_above_fold,
                  target_url,
                  MAX(is_external) as is_external,
                  MIN(pharma_context) as pharma_context,
                  MIN(value_tier) as value_tier,
                  MIN(value_reason) as value_reason,
                  MIN(owner) as owner,
                  MIN(measurement_status) as measurement_status,
                  COUNT(*) as page_count,
                  GROUP_CONCAT(DISTINCT page_url) as page_urls
               FROM elements WHERE scan_id = ?
               GROUP BY COALESCE(element_text, ''), COALESCE(css_selector, ''), COALESCE(target_url, '')
               ORDER BY page_count DESC, element_type""",
            (scan_id,),
        )
    else:
        cursor = await db.execute(
            """SELECT page_url, page_title, element_type, action_type,
                      element_text, css_selector, section_context,
                      container_context, is_above_fold, target_url,
                      is_external, pharma_context, value_tier,
                      value_reason, owner, measurement_status
               FROM elements WHERE scan_id = ?
               ORDER BY id""",
            (scan_id,),
        )
    elements = [dict(row) for row in await cursor.fetchall()]
    return dict(scan), elements


@router.get("/{scan_id}/xlsx")
async def export_xlsx(
    scan_id: str,
    dedup: bool = Query(False),
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Download scan results as XLSX."""
    scan_info, elements = await _get_scan_data(scan_id, user["username"], db, dedup=dedup)

    buffer = generate_xlsx(elements, scan_info, dedup=dedup)
    domain = scan_info.get("domain", "export")
    filename = f"tapmap_{domain}_{scan_id}.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{scan_id}/csv")
async def export_csv(
    scan_id: str,
    dedup: bool = Query(False),
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Download scan results as CSV."""
    scan_info, elements = await _get_scan_data(scan_id, user["username"], db, dedup=dedup)

    tag_name = scan_info.get("tag_name") or "Pharma"
    csv_content = generate_csv(elements, tag_name=tag_name, dedup=dedup)
    domain = scan_info.get("domain", "export")
    filename = f"tapmap_{domain}_{scan_id}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
