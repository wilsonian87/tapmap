"""Phase 1 crawler tests — stubs for now, expanded in Phase 2+."""
from crawler.models import ScanConfig, RobotsResult


def test_scan_config_rate_floor():
    """Rate limit cannot go below 0.5 req/sec."""
    config = ScanConfig(url="https://example.com", rate_limit=0.1)
    assert config.rate_limit == 0.5


def test_scan_config_max_pages_clamped():
    """Max pages is clamped to 1-1000."""
    config = ScanConfig(url="https://example.com", max_pages=5000)
    assert config.max_pages == 1000

    config2 = ScanConfig(url="https://example.com", max_pages=0)
    assert config2.max_pages == 1


def test_robots_result_model():
    """RobotsResult model works."""
    result = RobotsResult(found=True, allowed=True, disallowed_paths=["/admin"])
    assert result.found
    assert result.allowed
    assert len(result.disallowed_paths) == 1
