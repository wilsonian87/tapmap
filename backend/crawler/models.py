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


class ElementResult(BaseModel):
    page_url: str
    page_title: Optional[str] = None
    element_type: str  # link | button | form | menu | tab | accordion | download | unknown
    action_type: Optional[str] = None  # navigate | submit | toggle | expand | download | other
    element_text: Optional[str] = None
    css_selector: Optional[str] = None
    section_context: Optional[str] = None  # nearest H1/H2/H3
    container_context: str = "unknown"  # header | nav | main | footer | aside | dialog | unknown
    is_above_fold: bool = False
    target_url: Optional[str] = None
    is_external: bool = False
    pharma_context: Optional[str] = None  # isi | adverse_event | patient_enrollment | hcp_gate | fair_balance
    notes: Optional[str] = None


class PageResult(BaseModel):
    url: str
    title: Optional[str] = None
    status_code: Optional[int] = None
    depth: int = 0
    elements: list[ElementResult] = []
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
