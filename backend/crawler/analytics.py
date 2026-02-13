"""Analytics framework detection via browser JS evaluation.

Detects common analytics/tag management platforms by checking for their
global JavaScript objects. Returns a deduplicated list of framework names.
"""

import logging
from playwright.async_api import Page

logger = logging.getLogger(__name__)

DETECTION_JS = """
() => {
    const detected = [];
    try { if (window.dataLayer && Array.isArray(window.dataLayer)) detected.push("GTM"); } catch (e) {}
    try { if (window._satellite && typeof window._satellite.getVar === "function") detected.push("Adobe Launch"); } catch (e) {}
    try { if (window.utag) detected.push("Tealium"); } catch (e) {}
    try { if (window.analytics && typeof window.analytics.track === "function") detected.push("Segment"); } catch (e) {}
    try { if (typeof window.gtag === "function") detected.push("GA4"); } catch (e) {}
    try { if (window.s && typeof window.s.t === "function") detected.push("Adobe Analytics"); } catch (e) {}
    try { if (typeof window.hj === "function") detected.push("Hotjar"); } catch (e) {}
    return detected;
}
"""


async def detect_analytics(page: Page) -> list[str]:
    """Detect analytics frameworks on the current page.

    Returns a list of detected framework names (e.g. ["GTM", "GA4"]).
    Failures are caught silently -- returns empty list on error.
    """
    try:
        result = await page.evaluate(DETECTION_JS)
        if result:
            logger.debug("Analytics detected: %s", result)
        return result or []
    except Exception as e:
        logger.debug("Analytics detection failed: %s", str(e))
        return []
