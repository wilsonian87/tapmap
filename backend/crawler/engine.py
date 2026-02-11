import asyncio
import time
import logging
from urllib.parse import urljoin, urlparse, urldefrag
from typing import Optional
from playwright.async_api import async_playwright, Page, Browser

from crawler.models import ScanConfig, PageResult, CrawlProgress
from crawler.robots import check_robots_txt
from crawler.extractor import extract_elements
from crawler.consent import handle_consent, ConsentResult
from config import settings

logger = logging.getLogger(__name__)


class CrawlEngine:
    """Crawl engine: discovers pages and extracts interactive elements.

    Respects robots.txt, rate limits, page caps, and depth limits.
    Handles cookie/consent banners before extraction.
    """

    def __init__(self, config: ScanConfig):
        self.config = config
        self.parsed_base = urlparse(config.url)
        self.base_domain = self.parsed_base.netloc
        self.visited: set[str] = set()
        self.pages: list[PageResult] = []
        self.queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
        self.progress = CrawlProgress(scan_id="", status="running")
        self.consent_result: ConsentResult | None = None
        self.total_elements: int = 0

    def _normalize_url(self, url: str) -> str:
        """Normalize URL: remove fragment, strip trailing slash."""
        url, _ = urldefrag(url)
        if url.endswith("/"):
            url = url.rstrip("/")
        return url

    def _is_same_domain(self, url: str) -> bool:
        """Check if URL belongs to the same domain."""
        parsed = urlparse(url)
        return parsed.netloc == self.base_domain

    def _is_crawlable(self, url: str) -> bool:
        """Filter out non-page URLs."""
        parsed = urlparse(url)

        # Must be http(s)
        if parsed.scheme not in ("http", "https"):
            return False

        # Must be same domain
        if not self._is_same_domain(url):
            return False

        # Skip binary/non-HTML resources
        skip_extensions = {
            ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
            ".mp4", ".mp3", ".wav", ".avi", ".mov",
            ".zip", ".tar", ".gz", ".rar",
            ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
            ".css", ".js", ".json", ".xml", ".ico",
        }
        path_lower = parsed.path.lower()
        for ext in skip_extensions:
            if path_lower.endswith(ext):
                return False

        return True

    async def _extract_links(self, page: Page) -> list[str]:
        """Extract all href links from the current page."""
        links = await page.evaluate("""
            () => {
                const anchors = document.querySelectorAll('a[href]');
                return Array.from(anchors).map(a => a.href).filter(h => h);
            }
        """)
        return links

    async def crawl(self, scan_id: str) -> list[PageResult]:
        """Execute the crawl. Returns list of discovered pages with elements."""
        self.progress.scan_id = scan_id
        start_time = time.time()

        # Check robots.txt first
        robots = await check_robots_txt(self.config.url)
        logger.info(
            "robots.txt: found=%s, allowed=%s", robots.found, robots.allowed
        )

        if not robots.allowed:
            logger.warning("robots.txt disallows crawling %s", self.config.url)
            self.progress.status = "blocked_by_robots"
            return []

        # Seed the queue
        start_url = self._normalize_url(self.config.url)
        await self.queue.put((start_url, 0))

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent=settings.user_agent,
                viewport={"width": 1280, "height": 800},
            )

            try:
                await asyncio.wait_for(
                    self._crawl_loop(context, robots),
                    timeout=settings.scan_timeout_seconds,
                )
            except asyncio.TimeoutError:
                logger.warning("Crawl timed out after %ds", settings.scan_timeout_seconds)
                self.progress.status = "timeout"
            finally:
                await context.close()
                await browser.close()

        elapsed = time.time() - start_time
        logger.info(
            "Crawl complete: %d pages, %d elements in %.1fs",
            len(self.pages), self.total_elements, elapsed,
        )

        if self.progress.status == "running":
            self.progress.status = "completed"

        return self.pages

    async def _crawl_loop(self, context, robots):
        """Process URLs from queue with rate limiting."""
        delay = 1.0 / self.config.rate_limit
        consent_handled = False

        while not self.queue.empty():
            # Check page cap
            if len(self.pages) >= self.config.max_pages:
                logger.info("Reached page cap (%d)", self.config.max_pages)
                break

            url, depth = await self.queue.get()
            normalized = self._normalize_url(url)

            # Skip if already visited
            if normalized in self.visited:
                continue

            # Skip if too deep
            if depth > self.config.max_depth:
                continue

            self.visited.add(normalized)
            self.progress.current_url = normalized

            # Crawl the page
            result = await self._visit_page(
                context, normalized, depth,
                handle_consent_banner=not consent_handled,
            )
            self.pages.append(result)
            self.total_elements += len(result.elements)
            self.progress.pages_scanned = len(self.pages)
            self.progress.total_pages_found = len(self.visited) + self.queue.qsize()

            # Mark consent as handled after first page
            if not consent_handled:
                consent_handled = True

            logger.info(
                "[%d/%d] %s (depth=%d) -> %s (%d elements)",
                len(self.pages),
                self.config.max_pages,
                normalized,
                depth,
                result.title or "(no title)",
                len(result.elements),
            )

            # Rate limiting
            await asyncio.sleep(delay)

    async def _visit_page(
        self, context, url: str, depth: int,
        handle_consent_banner: bool = False,
    ) -> PageResult:
        """Visit a page, handle consent, extract elements, discover links."""
        page = await context.new_page()
        try:
            response = await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=30000,
            )

            if not response:
                return PageResult(url=url, depth=depth, error="No response")

            status_code = response.status

            # Skip non-success responses
            if status_code >= 400:
                logger.info("Skipping %s (HTTP %d)", url, status_code)
                return PageResult(
                    url=url, depth=depth, status_code=status_code,
                    error=f"HTTP {status_code}",
                )

            # Detect cross-domain redirects
            final_url = page.url
            if not self._is_same_domain(final_url):
                logger.info("Skipping %s (redirected to %s)", url, final_url)
                return PageResult(
                    url=url, depth=depth, status_code=status_code,
                    error=f"Redirected off-domain to {final_url}",
                )

            # Check content-type — only extract from HTML
            content_type = response.headers.get("content-type", "")
            if content_type and "html" not in content_type.lower():
                logger.info("Skipping %s (content-type: %s)", url, content_type)
                return PageResult(
                    url=url, depth=depth, status_code=status_code,
                    error=f"Non-HTML content: {content_type}",
                )

            # Wait for JS to settle
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass  # networkidle timeout is non-fatal

            title = await page.title()

            # Handle consent banner on first page
            if handle_consent_banner:
                self.consent_result = await handle_consent(page)
                if self.consent_result.detected:
                    logger.info(
                        "Consent: detected=%s, action=%s, framework=%s",
                        self.consent_result.detected,
                        self.consent_result.action,
                        self.consent_result.framework,
                    )

            # Extract interactive elements
            elements = await extract_elements(page, url)

            # Extract links and enqueue same-domain ones
            if depth < self.config.max_depth:
                links = await self._extract_links(page)
                for link in links:
                    norm = self._normalize_url(link)
                    if (
                        norm not in self.visited
                        and self._is_crawlable(norm)
                    ):
                        await self.queue.put((norm, depth + 1))

            return PageResult(
                url=url,
                title=title if title else None,
                status_code=status_code,
                depth=depth,
                elements=elements,
            )

        except Exception as e:
            logger.warning("Error visiting %s: %s", url, str(e))
            return PageResult(
                url=url,
                depth=depth,
                error=str(e),
            )
        finally:
            await page.close()
