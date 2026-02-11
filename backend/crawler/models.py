from pydantic import BaseModel, HttpUrl, field_validator
from typing import Optional


class ScanConfig(BaseModel):
    url: str
    max_pages: int = 200
    max_depth: int = 5
    rate_limit: float = 1.0

    @field_validator("rate_limit")
    @classmethod
    def enforce_rate_floor(cls, v: float) -> float:
        if v < 0.5:
            return 0.5
        return v

    @field_validator("max_pages")
    @classmethod
    def clamp_max_pages(cls, v: int) -> int:
        return max(1, min(v, 1000))

    @field_validator("max_depth")
    @classmethod
    def clamp_max_depth(cls, v: int) -> int:
        return max(1, min(v, 20))


class PageResult(BaseModel):
    url: str
    title: Optional[str] = None
    status_code: Optional[int] = None
    depth: int = 0
    error: Optional[str] = None


class CrawlProgress(BaseModel):
    scan_id: str
    pages_scanned: int = 0
    total_pages_found: int = 0
    current_url: Optional[str] = None
    status: str = "running"


class RobotsResult(BaseModel):
    found: bool
    allowed: bool
    raw_content: Optional[str] = None
    disallowed_paths: list[str] = []
