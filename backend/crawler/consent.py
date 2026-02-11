"""Cookie/consent banner detection and dismissal.

Priority cascade:
1. Accept All — click buttons matching accept/agree/allow patterns
2. Close/Dismiss — click X buttons, close, dismiss
3. DOM Bypass — remove overlay elements, restore body overflow

Records action taken for audit trail.
"""

import logging
from dataclasses import dataclass
from playwright.async_api import Page

logger = logging.getLogger(__name__)


@dataclass
class ConsentResult:
    detected: bool = False
    action: str = "none"  # accept_all | close | bypass_css | none | failed
    framework: str = "unknown"  # onetrust | trustarc | cookiebot | unknown
    notes: str | None = None


# Consent framework detection selectors
FRAMEWORK_SIGNATURES = {
    "onetrust": "#onetrust-banner-sdk, .onetrust-pc-dark-filter, #ot-sdk-btn",
    "trustarc": "#truste-consent-track, .truste_overlay, #consent_blackbar",
    "cookiebot": "#CybotCookiebotDialog, .CybotCookiebotDialogActive",
    "evidon": "#_evidon_banner, #_evidon-barrier-wrapper",
    "quantcast": ".qc-cmp2-container, #qc-cmp2-ui",
    "didomi": "#didomi-host, .didomi-popup-container",
}

# Accept button selectors and text patterns (priority order)
ACCEPT_SELECTORS = [
    # Common consent platform buttons
    "#onetrust-accept-btn-handler",
    "#truste-consent-button",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    ".qc-cmp2-summary-buttons button:first-child",
    "#didomi-notice-agree-button",
    "#accept-all-cookies",
    "#accept-cookies",
    "#cookie-accept",
    # Generic patterns
    'button[id*="accept" i]',
    'button[id*="agree" i]',
    'a[id*="accept" i]',
]

ACCEPT_TEXT_PATTERNS = [
    "accept all",
    "accept cookies",
    "accept",
    "i agree",
    "agree",
    "allow all",
    "allow cookies",
    "got it",
    "ok",
    "continue",
    "i understand",
]

# Close/dismiss selectors (fallback)
CLOSE_SELECTORS = [
    "#onetrust-close-btn-container button",
    ".onetrust-close-btn-handler",
    "#truste-consent-close",
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    'button[aria-label="Dismiss"]',
    ".cookie-banner-close",
    ".consent-close",
    'button.close[data-dismiss]',
]

CLOSE_TEXT_PATTERNS = [
    "close",
    "dismiss",
    "no thanks",
    "maybe later",
    "continue without",
    "x",
]


async def detect_framework(page: Page) -> str:
    """Detect which consent framework is in use."""
    for name, selector in FRAMEWORK_SIGNATURES.items():
        try:
            el = await page.query_selector(selector)
            if el:
                return name
        except Exception:
            continue
    return "unknown"


async def _try_click_selectors(page: Page, selectors: list[str]) -> bool:
    """Try clicking elements by CSS selector."""
    for selector in selectors:
        try:
            el = await page.query_selector(selector)
            if el and await el.is_visible():
                await el.click(timeout=3000)
                await page.wait_for_timeout(1000)
                return True
        except Exception:
            continue
    return False


async def _try_click_text(page: Page, patterns: list[str]) -> bool:
    """Try clicking elements by visible text content."""
    for text in patterns:
        try:
            # Try button/a elements with matching text
            for tag in ["button", "a", "span", "div"]:
                locator = page.locator(f"{tag}").filter(has_text=text)
                count = await locator.count()
                for i in range(min(count, 3)):
                    el = locator.nth(i)
                    if await el.is_visible():
                        box = await el.bounding_box()
                        # Skip tiny elements (probably not consent buttons)
                        if box and box["width"] > 30 and box["height"] > 15:
                            await el.click(timeout=3000)
                            await page.wait_for_timeout(1000)
                            return True
        except Exception:
            continue
    return False


async def _try_dom_bypass(page: Page) -> bool:
    """Last resort: remove overlay elements and restore scrolling."""
    try:
        removed = await page.evaluate("""
            () => {
                let removed = 0;

                // Remove high z-index overlays
                const allEls = document.querySelectorAll('div, aside, section');
                for (const el of allEls) {
                    const style = window.getComputedStyle(el);
                    const zIndex = parseInt(style.zIndex);
                    if (zIndex > 9000 && style.position === 'fixed') {
                        el.remove();
                        removed++;
                    }
                }

                // Restore body scrolling
                document.body.style.overflow = 'auto';
                document.documentElement.style.overflow = 'auto';

                // Remove backdrop/overlay classes
                const overlays = document.querySelectorAll(
                    '.modal-backdrop, .overlay, [class*="overlay"], [class*="backdrop"]'
                );
                overlays.forEach(el => {
                    if (window.getComputedStyle(el).position === 'fixed') {
                        el.remove();
                        removed++;
                    }
                });

                return removed;
            }
        """)
        return removed > 0
    except Exception:
        return False


async def _has_visible_consent_banner(page: Page) -> bool:
    """Check if any consent banner is currently visible."""
    try:
        return await page.evaluate("""
            () => {
                // Check common consent containers
                const selectors = [
                    '#onetrust-banner-sdk',
                    '#truste-consent-track',
                    '#CybotCookiebotDialog',
                    '#_evidon_banner',
                    '.qc-cmp2-container',
                    '#didomi-host',
                    '[class*="cookie-banner"]',
                    '[class*="consent-banner"]',
                    '[class*="cookie-notice"]',
                    '[id*="cookie-banner"]',
                    '[id*="consent-banner"]',
                    '[id*="gdpr"]',
                ];

                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const style = window.getComputedStyle(el);
                        if (style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            parseFloat(style.opacity) > 0) {
                            return true;
                        }
                    }
                }

                // Heuristic: look for fixed-position elements with cookie-related text
                const fixed = document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
                for (const el of fixed) {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('cookie') || text.includes('consent') || text.includes('privacy')) {
                        if (text.length < 2000) return true;
                    }
                }

                return false;
            }
        """)
    except Exception:
        return False


async def handle_consent(page: Page) -> ConsentResult:
    """Detect and attempt to dismiss cookie/consent banners.

    Returns a ConsentResult with detection status and action taken.
    """
    # Wait briefly for consent banners to appear
    await page.wait_for_timeout(2000)

    # Check if there's a visible consent banner
    has_banner = await _has_visible_consent_banner(page)
    if not has_banner:
        return ConsentResult(detected=False, action="none")

    logger.info("Consent banner detected on %s", page.url)

    # Detect framework
    framework = await detect_framework(page)
    logger.info("Consent framework: %s", framework)

    # Strategy 1: Accept All (by selector)
    if await _try_click_selectors(page, ACCEPT_SELECTORS):
        logger.info("Consent dismissed via accept selector")
        return ConsentResult(
            detected=True, action="accept_all", framework=framework
        )

    # Strategy 2: Accept All (by text)
    if await _try_click_text(page, ACCEPT_TEXT_PATTERNS):
        logger.info("Consent dismissed via accept text match")
        return ConsentResult(
            detected=True, action="accept_all", framework=framework
        )

    # Strategy 3: Close/Dismiss (by selector)
    if await _try_click_selectors(page, CLOSE_SELECTORS):
        logger.info("Consent dismissed via close selector")
        return ConsentResult(
            detected=True, action="close", framework=framework
        )

    # Strategy 4: Close/Dismiss (by text)
    if await _try_click_text(page, CLOSE_TEXT_PATTERNS):
        logger.info("Consent dismissed via close text match")
        return ConsentResult(
            detected=True, action="close", framework=framework
        )

    # Strategy 5: DOM Bypass
    if await _try_dom_bypass(page):
        logger.info("Consent bypassed via DOM removal")
        return ConsentResult(
            detected=True, action="bypass_css", framework=framework,
            notes="Overlay removed via DOM manipulation",
        )

    # All strategies failed
    logger.warning("Failed to dismiss consent banner on %s", page.url)
    return ConsentResult(
        detected=True, action="failed", framework=framework,
        notes="All dismissal strategies exhausted",
    )
