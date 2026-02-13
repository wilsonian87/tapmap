"""Tests for analytics framework detection signatures."""

import pytest
from unittest.mock import AsyncMock, MagicMock
from crawler.analytics import detect_analytics, DETECTION_JS


@pytest.mark.asyncio
async def test_detect_analytics_returns_list():
    """detect_analytics returns a list of framework names."""
    page = AsyncMock()
    page.evaluate = AsyncMock(return_value=["GTM", "GA4"])
    result = await detect_analytics(page)
    assert result == ["GTM", "GA4"]
    page.evaluate.assert_called_once_with(DETECTION_JS)


@pytest.mark.asyncio
async def test_detect_analytics_empty_page():
    """Returns empty list when no frameworks detected."""
    page = AsyncMock()
    page.evaluate = AsyncMock(return_value=[])
    result = await detect_analytics(page)
    assert result == []


@pytest.mark.asyncio
async def test_detect_analytics_none_result():
    """Returns empty list when evaluate returns None."""
    page = AsyncMock()
    page.evaluate = AsyncMock(return_value=None)
    result = await detect_analytics(page)
    assert result == []


@pytest.mark.asyncio
async def test_detect_analytics_exception_returns_empty():
    """Returns empty list on JS evaluation failure (non-blocking)."""
    page = AsyncMock()
    page.evaluate = AsyncMock(side_effect=Exception("Page crashed"))
    result = await detect_analytics(page)
    assert result == []


def test_detection_js_contains_all_frameworks():
    """DETECTION_JS checks for all expected frameworks."""
    expected = ["GTM", "Adobe Launch", "Tealium", "Segment", "GA4", "Adobe Analytics", "Hotjar"]
    for name in expected:
        assert name in DETECTION_JS, f"{name} not found in DETECTION_JS"


def test_detection_js_checks_specific_globals():
    """DETECTION_JS references the correct window globals."""
    assert "window.dataLayer" in DETECTION_JS
    assert "window._satellite" in DETECTION_JS
    assert "window.utag" in DETECTION_JS
    assert "window.analytics" in DETECTION_JS
    assert "window.gtag" in DETECTION_JS
    assert "window.s" in DETECTION_JS
    assert "window.hj" in DETECTION_JS
