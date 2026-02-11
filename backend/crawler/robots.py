import httpx
from urllib.parse import urljoin
from robotexclusionrulesparser import RobotExclusionRulesParser

from crawler.models import RobotsResult
from config import settings


async def check_robots_txt(base_url: str, path: str = "/") -> RobotsResult:
    """Fetch and parse robots.txt for a domain.

    Returns whether crawling is allowed for our user agent.
    """
    robots_url = urljoin(base_url, "/robots.txt")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                robots_url,
                headers={"User-Agent": settings.user_agent},
                follow_redirects=True,
            )

        if response.status_code == 404:
            # No robots.txt = everything allowed
            return RobotsResult(found=False, allowed=True)

        if response.status_code != 200:
            # Can't fetch robots.txt — proceed cautiously, assume allowed
            return RobotsResult(found=False, allowed=True)

        content = response.text
        parser = RobotExclusionRulesParser()
        parser.parse(content)

        allowed = parser.is_allowed(settings.user_agent, path)

        # Collect disallowed paths for our agent
        disallowed = []
        for line in content.splitlines():
            line = line.strip()
            if line.lower().startswith("disallow:"):
                p = line.split(":", 1)[1].strip()
                if p:
                    disallowed.append(p)

        return RobotsResult(
            found=True,
            allowed=allowed,
            raw_content=content,
            disallowed_paths=disallowed,
        )

    except httpx.RequestError:
        # Network error fetching robots.txt — proceed cautiously
        return RobotsResult(found=False, allowed=True)


async def is_path_allowed(
    parser: RobotExclusionRulesParser, path: str
) -> bool:
    """Check if a specific path is allowed by the parsed robots.txt."""
    return parser.is_allowed(settings.user_agent, path)
