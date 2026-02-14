"""DOM element extraction engine.

Discovers interactive elements on a page and returns structured metadata.
Runs JavaScript in the Playwright browser context for full DOM access.
"""

import logging
from playwright.async_api import Page
from crawler.models import ElementResult

logger = logging.getLogger(__name__)

# Pharma-specific text patterns for context hints
PHARMA_PATTERNS = {
    "isi": [
        "important safety information",
        "full prescribing information",
        "medication guide",
        "prescribing information",
        "safety information",
    ],
    "adverse_event": [
        "report side effects",
        "adverse event",
        "medwatch",
        "report adverse",
        "side effect",
    ],
    "patient_enrollment": [
        "patient support",
        "copay",
        "savings card",
        "savings program",
        "co-pay",
        "patient assistance",
        "enroll",
        "sign up for savings",
    ],
    "hcp_gate": [
        "are you a healthcare professional",
        "for us healthcare professionals",
        "healthcare provider",
        "hcp portal",
        "for healthcare professionals",
        "i am a healthcare",
    ],
    "fair_balance": [
        "indications and usage",
        "contraindications",
        "warnings and precautions",
        "boxed warning",
        "black box warning",
    ],
}


def _detect_pharma_builtin(text: str | None, url: str | None = None) -> str | None:
    """Check element text/URL against built-in pharma patterns (V1 behavior)."""
    if not text:
        return None
    text_lower = text.lower()
    for category, patterns in PHARMA_PATTERNS.items():
        for pattern in patterns:
            if pattern in text_lower:
                return category
    # URL-based detection for downloads
    if url:
        url_lower = url.lower()
        if "prescribing" in url_lower or "/pi" in url_lower:
            return "isi"
        if "medguide" in url_lower or "medication-guide" in url_lower:
            return "isi"
    return None


def detect_tag_context(
    text: str | None,
    url: str | None = None,
    tag_name: str = "Pharma",
    keywords: list[str] | None = None,
) -> str | None:
    """Detect tag context for an element.

    - tag_name="Pharma" + keywords=None → uses built-in PHARMA_PATTERNS
    - Custom tag with keywords → substring match against keyword list
    - Returns matched keyword/category string or None
    """
    if tag_name == "Pharma" and not keywords:
        return _detect_pharma_builtin(text, url)

    if not keywords:
        return None

    combined = ""
    if text:
        combined += text.lower()
    if url:
        combined += " " + url.lower()
    if not combined.strip():
        return None

    for keyword in keywords:
        if keyword.lower() in combined:
            return keyword
    return None


# The extraction script runs in the browser context.
# Returns a list of raw element objects.
EXTRACTION_JS = """
() => {
    const elements = [];
    const viewportHeight = window.innerHeight;
    const seen = new Set();

    function getLabel(el) {
        // 1. Visible text (prefer short text)
        const text = (el.innerText || '').trim();
        if (text && text.length > 0 && text.length < 200) return text;

        // 2. aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim();

        // 3. aria-labelledby
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
            const ids = labelledBy.split(/\\s+/);
            const parts = ids.map(id => {
                const ref = document.getElementById(id);
                return ref ? (ref.innerText || '').trim() : '';
            }).filter(Boolean);
            if (parts.length) return parts.join(' ');
        }

        // 4. title attribute
        if (el.title) return el.title.trim();

        // 5. alt attribute (images inside links/buttons)
        const img = el.querySelector('img[alt]');
        if (img && img.alt) return img.alt.trim();

        // 6. value (for inputs)
        if (el.value && typeof el.value === 'string') return el.value.trim();

        // 7. placeholder
        if (el.placeholder) return el.placeholder.trim();

        // 8. Long text fallback — truncate
        if (text && text.length >= 200) return text.substring(0, 197) + '...';

        return null;
    }

    function getSectionContext(el) {
        // Walk up and back to find nearest heading
        let current = el;
        let depth = 0;
        while (current && current !== document.body && depth < 10) {
            // Check previous siblings
            let sibling = current.previousElementSibling;
            let siblingDepth = 0;
            while (sibling && siblingDepth < 5) {
                if (/^H[1-3]$/i.test(sibling.tagName)) {
                    return (sibling.innerText || '').trim().substring(0, 200);
                }
                // Check last child of sibling for headings
                const nested = sibling.querySelector('h1, h2, h3');
                if (nested) {
                    return (nested.innerText || '').trim().substring(0, 200);
                }
                sibling = sibling.previousElementSibling;
                siblingDepth++;
            }
            current = current.parentElement;
            depth++;
        }
        // Fallback: find nearest heading in same container
        const parent = el.closest('section, article, div[class], main, aside');
        if (parent) {
            const heading = parent.querySelector('h1, h2, h3');
            if (heading) return (heading.innerText || '').trim().substring(0, 200);
        }
        return null;
    }

    function getContainerContext(el) {
        let current = el.parentElement;
        while (current && current !== document.body) {
            const tag = current.tagName.toLowerCase();
            const role = (current.getAttribute('role') || '').toLowerCase();

            if (tag === 'header' || role === 'banner') return 'header';
            if (tag === 'nav' || role === 'navigation') return 'nav';
            if (tag === 'main' || role === 'main') return 'main';
            if (tag === 'footer' || role === 'contentinfo') return 'footer';
            if (tag === 'aside' || role === 'complementary') return 'aside';
            if (tag === 'dialog' || role === 'dialog') return 'dialog';

            current = current.parentElement;
        }
        return 'unknown';
    }

    function isAboveFold(el) {
        try {
            const rect = el.getBoundingClientRect();
            return rect.top < viewportHeight && rect.bottom > 0;
        } catch { return false; }
    }

    function isVisible(el) {
        try {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none') return false;
            if (style.visibility === 'hidden') return false;
            if (parseFloat(style.opacity) === 0) return false;
            return true;
        } catch { return false; }
    }

    function getSelector(el) {
        try {
            if (el.id) return '#' + CSS.escape(el.id);

            const parts = [];
            let current = el;
            let depth = 0;
            while (current && current !== document.body && depth < 5) {
                let selector = current.tagName.toLowerCase();
                if (current.id) {
                    parts.unshift('#' + CSS.escape(current.id));
                    break;
                }
                // Add distinguishing class if available
                if (current.className && typeof current.className === 'string') {
                    const cls = current.className.trim().split(/\\s+/)
                        .filter(c => c.length < 40 && !c.includes(':'))
                        .slice(0, 2);
                    if (cls.length) selector += '.' + cls.map(c => CSS.escape(c)).join('.');
                }
                // Add nth-child if needed for uniqueness
                if (current.parentElement) {
                    const siblings = Array.from(current.parentElement.children)
                        .filter(s => s.tagName === current.tagName);
                    if (siblings.length > 1) {
                        const idx = siblings.indexOf(current) + 1;
                        selector += ':nth-child(' + idx + ')';
                    }
                }
                parts.unshift(selector);
                current = current.parentElement;
                depth++;
            }
            return parts.join(' > ').substring(0, 500);
        } catch { return el.tagName.toLowerCase(); }
    }

    function addElement(el, type, actionType) {
        if (!isVisible(el)) return;

        const selector = getSelector(el);
        const key = type + ':' + selector;
        if (seen.has(key)) return;
        seen.add(key);

        const label = getLabel(el);
        const href = el.href || el.getAttribute('href') || null;
        let targetUrl = null;
        let isExternal = false;

        if (href && !href.startsWith('javascript:')) {
            try {
                const url = new URL(href, location.origin);
                targetUrl = url.href;
                isExternal = url.hostname !== location.hostname;
            } catch {}
        }

        elements.push({
            element_type: type,
            action_type: actionType,
            element_text: label ? label.substring(0, 500) : null,
            css_selector: selector,
            section_context: getSectionContext(el),
            container_context: getContainerContext(el),
            is_above_fold: isAboveFold(el),
            target_url: targetUrl,
            is_external: isExternal,
        });
    }

    // === TIER A: Direct interactive elements ===

    // Links
    document.querySelectorAll('a[href]').forEach(el => {
        const href = (el.getAttribute('href') || '').toLowerCase();
        if (href.startsWith('mailto:') || href.startsWith('tel:')) {
            addElement(el, 'link', 'other');
        } else if (href.match(/\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|csv)$/i)) {
            addElement(el, 'download', 'download');
        } else {
            addElement(el, 'link', 'navigate');
        }
    });

    // Buttons
    document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]').forEach(el => {
        const t = (el.type || '').toLowerCase();
        addElement(el, 'button', t === 'submit' ? 'submit' : 'other');
    });

    // Forms
    document.querySelectorAll('form').forEach(el => {
        addElement(el, 'form', 'submit');
    });

    // Elements with onclick handlers (not already captured)
    document.querySelectorAll('[onclick]').forEach(el => {
        if (!el.matches('a, button, input[type="button"], input[type="submit"]')) {
            addElement(el, 'button', 'other');
        }
    });

    // ARIA role="button" on non-button elements
    document.querySelectorAll('[role="button"]').forEach(el => {
        if (!el.matches('button, input[type="button"], input[type="submit"]')) {
            addElement(el, 'button', 'other');
        }
    });

    // ARIA role="link" on non-anchor elements
    document.querySelectorAll('[role="link"]').forEach(el => {
        if (!el.matches('a')) {
            addElement(el, 'link', 'navigate');
        }
    });

    // === TIER B: Pattern-based interactive elements ===

    // Tabs
    document.querySelectorAll('[role="tab"]').forEach(el => {
        addElement(el, 'tab', 'toggle');
    });

    // Accordions / expandable (aria-expanded on non-tab elements)
    document.querySelectorAll('[aria-expanded]').forEach(el => {
        if (!el.matches('[role="tab"]')) {
            addElement(el, 'accordion', 'expand');
        }
    });

    // Menu items
    document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]').forEach(el => {
        addElement(el, 'menu', 'navigate');
    });

    // Details/summary (native HTML accordion)
    document.querySelectorAll('summary').forEach(el => {
        addElement(el, 'accordion', 'toggle');
    });

    // Select dropdowns (interactive form elements)
    document.querySelectorAll('select').forEach(el => {
        addElement(el, 'form', 'toggle');
    });

    // Clickable divs/spans with cursor: pointer and event listeners
    // (Heuristic — only check elements with pointer cursor that aren't already captured)
    document.querySelectorAll('[style*="cursor: pointer"], [style*="cursor:pointer"]').forEach(el => {
        if (!el.matches('a, button, input, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], summary')) {
            addElement(el, 'button', 'other');
        }
    });

    return elements;
}
"""


async def extract_elements(
    page: Page,
    page_url: str,
    tag_name: str = "Pharma",
    tag_keywords: list[str] | None = None,
) -> list[ElementResult]:
    """Extract all interactive elements from a page.

    Returns structured ElementResult objects with full metadata.
    """
    try:
        raw_elements = await page.evaluate(EXTRACTION_JS)
    except Exception as e:
        logger.warning("Extraction failed on %s: %s", page_url, str(e))
        return []

    results = []
    try:
        page_title = await page.title() or None
    except Exception:
        page_title = None

    for raw in raw_elements:
        # Detect tag context (pharma builtin or custom keywords)
        pharma_ctx = detect_tag_context(
            raw.get("element_text"),
            raw.get("target_url"),
            tag_name=tag_name,
            keywords=tag_keywords,
        )

        results.append(ElementResult(
            page_url=page_url,
            page_title=page_title,
            element_type=raw.get("element_type", "unknown"),
            action_type=raw.get("action_type"),
            element_text=raw.get("element_text"),
            css_selector=raw.get("css_selector"),
            section_context=raw.get("section_context"),
            container_context=raw.get("container_context", "unknown"),
            is_above_fold=raw.get("is_above_fold", False),
            target_url=raw.get("target_url"),
            is_external=raw.get("is_external", False),
            pharma_context=pharma_ctx,
        ))

    logger.info(
        "Extracted %d elements from %s (pharma hints: %d)",
        len(results),
        page_url,
        sum(1 for r in results if r.pharma_context),
    )

    return results
