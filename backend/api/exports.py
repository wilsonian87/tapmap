"""Export endpoints for downloading scan results."""

import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response
import aiosqlite

from db.database import get_db
from auth.security import get_current_user
from export.xlsx import generate_xlsx
from export.csv_export import generate_csv

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/exports", tags=["exports"])


async def _get_scan_data(
    scan_id: str, username: str, db: aiosqlite.Connection
) -> tuple[dict, list[dict]]:
    """Fetch scan info and elements for export."""
    cursor = await db.execute(
        "SELECT * FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, username),
    )
    scan = await cursor.fetchone()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

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
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Download scan results as XLSX."""
    scan_info, elements = await _get_scan_data(scan_id, user["username"], db)

    buffer = generate_xlsx(elements, scan_info)
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
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Download scan results as CSV."""
    scan_info, elements = await _get_scan_data(scan_id, user["username"], db)

    csv_content = generate_csv(elements)
    domain = scan_info.get("domain", "export")
    filename = f"tapmap_{domain}_{scan_id}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
