"""AI-assisted element classification using Claude Haiku.

Classifies interactive elements as HVA (High-Value Action), MVA (Medium-Value Action),
or LVA (Low-Value Action) based on pharma domain context.
"""

import asyncio
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
import aiosqlite

from config import settings
from db.database import get_db
from auth.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scans", tags=["classify"])

BATCH_SIZE = 50

CLASSIFICATION_PROMPT = """You are a pharma digital measurement expert. Classify each interactive website element as:

- **HVA** (High-Value Action): Elements that directly drive patient/HCP engagement with core brand content. Examples: ISI links, prescribing information downloads, patient enrollment forms, adverse event reporting, HCP portal gates, dosing calculators, savings card signups.

- **MVA** (Medium-Value Action): Elements that support brand engagement but aren't primary conversion points. Examples: educational content links, video players, FAQ accordions, condition information tabs, doctor finder tools, newsletter signups.

- **LVA** (Low-Value Action): Standard website navigation or utility elements with minimal measurement value. Examples: cookie consent buttons, social media links, generic navigation, footer links, legal disclaimers, language selectors.

For each element, return a JSON object with:
- "id": the element ID provided
- "tier": one of "HVA", "MVA", or "LVA"
- "reason": a brief (1-sentence) explanation

Respond with ONLY a JSON array of classification objects. No other text.

Elements to classify:
"""


def _format_element_for_prompt(el: dict) -> dict:
    """Format an element row for the classification prompt."""
    return {
        "id": el["id"],
        "type": el.get("element_type", "unknown"),
        "text": el.get("element_text") or "(no text)",
        "container": el.get("container_context", "unknown"),
        "section": el.get("section_context") or "(none)",
        "target_url": el.get("target_url") or "(none)",
        "pharma_context": el.get("pharma_context") or "(none)",
        "is_above_fold": bool(el.get("is_above_fold")),
    }


def _classify_batch_sync(elements: list[dict], api_key: str) -> list[dict]:
    """Send a batch of elements to Claude Haiku for classification (synchronous).

    Runs in a thread via asyncio.to_thread so it doesn't block the event loop.
    """
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)

    formatted = [_format_element_for_prompt(el) for el in elements]
    prompt_content = CLASSIFICATION_PROMPT + json.dumps(formatted, indent=2)

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt_content}],
    )

    response_text = message.content[0].text.strip()

    # Parse JSON response (handle markdown code blocks)
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        response_text = "\n".join(lines[1:-1])

    try:
        classifications = json.loads(response_text)
    except json.JSONDecodeError:
        logger.error("Failed to parse classification response: %s", response_text[:500])
        return []

    return classifications


# Track running classification tasks
_running_tasks: dict[str, asyncio.Task] = {}


async def _run_classification(scan_id: str, username: str):
    """Background task: classify all unclassified elements in a scan."""
    db_path = settings.database_url
    import aiosqlite as _aiosqlite

    async with _aiosqlite.connect(db_path) as db:
        db.row_factory = _aiosqlite.Row

        # Verify ownership
        cursor = await db.execute(
            "SELECT scan_id FROM scans WHERE scan_id = ? AND created_by = ?",
            (scan_id, username),
        )
        if not await cursor.fetchone():
            logger.error("Classification failed: scan %s not owned by %s", scan_id, username)
            return

        # Fetch unclassified elements
        cursor = await db.execute(
            """SELECT id, element_type, element_text, css_selector,
                      container_context, section_context, target_url,
                      pharma_context, is_above_fold
               FROM elements
               WHERE scan_id = ? AND (value_tier IS NULL OR value_tier = '')
               ORDER BY id""",
            (scan_id,),
        )
        elements = [dict(row) for row in await cursor.fetchall()]

        if not elements:
            logger.info("No unclassified elements for scan %s", scan_id)
            return

        logger.info("Classifying %d elements for scan %s", len(elements), scan_id)

        # Process in batches
        for i in range(0, len(elements), BATCH_SIZE):
            batch = elements[i : i + BATCH_SIZE]
            try:
                classifications = await asyncio.to_thread(
                    _classify_batch_sync, batch, settings.anthropic_api_key
                )
            except Exception as e:
                logger.error("Classification batch %d failed: %s", i, str(e))
                continue

            # Write results to DB
            for clf in classifications:
                eid = clf.get("id")
                tier = clf.get("tier", "").upper()
                reason = clf.get("reason", "")

                if tier not in ("HVA", "MVA", "LVA"):
                    continue

                await db.execute(
                    "UPDATE elements SET value_tier = ?, value_reason = ? WHERE id = ? AND scan_id = ?",
                    (tier, reason, eid, scan_id),
                )

            await db.commit()
            logger.info(
                "Classified batch %d-%d for scan %s (%d results)",
                i, min(i + BATCH_SIZE, len(elements)), scan_id, len(classifications),
            )

    # Clean up task reference
    _running_tasks.pop(scan_id, None)
    logger.info("Classification complete for scan %s", scan_id)


@router.post("/{scan_id}/classify")
async def start_classification(
    scan_id: str,
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Start AI classification for a scan's elements."""
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ANTHROPIC_API_KEY not configured",
        )

    # Verify scan exists and user owns it
    cursor = await db.execute(
        "SELECT scan_id, scan_status FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, user["username"]),
    )
    scan = await cursor.fetchone()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    if scan["scan_status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scan must be completed before classification",
        )

    # Check if already running
    if scan_id in _running_tasks and not _running_tasks[scan_id].done():
        return {"status": "already_running", "scan_id": scan_id}

    # Launch background task
    task = asyncio.create_task(_run_classification(scan_id, user["username"]))
    _running_tasks[scan_id] = task

    return {"status": "started", "scan_id": scan_id}


@router.get("/{scan_id}/classify/status")
async def classification_status(
    scan_id: str,
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get classification progress for a scan."""
    cursor = await db.execute(
        "SELECT scan_id FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, user["username"]),
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Scan not found")

    # Count classified vs total
    cursor = await db.execute(
        """SELECT
              COUNT(*) as total,
              SUM(CASE WHEN value_tier IS NOT NULL AND value_tier != '' THEN 1 ELSE 0 END) as classified
           FROM elements WHERE scan_id = ?""",
        (scan_id,),
    )
    row = await cursor.fetchone()

    is_running = scan_id in _running_tasks and not _running_tasks[scan_id].done()

    return {
        "scan_id": scan_id,
        "total": row["total"],
        "classified": row["classified"],
        "is_running": is_running,
        "progress": round(row["classified"] / row["total"] * 100, 1) if row["total"] > 0 else 0,
    }


class ManualClassification(BaseModel):
    value_tier: str
    value_reason: Optional[str] = None


@router.patch("/{scan_id}/elements/{element_id}/classify")
async def manual_classify(
    scan_id: str,
    element_id: int,
    body: ManualClassification,
    user: dict = Depends(get_current_user),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Manually override classification for a single element."""
    # Verify scan ownership
    cursor = await db.execute(
        "SELECT scan_id FROM scans WHERE scan_id = ? AND created_by = ?",
        (scan_id, user["username"]),
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Scan not found")

    tier = body.value_tier.upper()
    if tier not in ("HVA", "MVA", "LVA"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="value_tier must be HVA, MVA, or LVA",
        )

    cursor = await db.execute(
        "UPDATE elements SET value_tier = ?, value_reason = ? WHERE id = ? AND scan_id = ?",
        (tier, body.value_reason or "", element_id, scan_id),
    )

    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Element not found")

    await db.commit()
    return {"status": "updated", "element_id": element_id, "value_tier": tier}
