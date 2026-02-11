from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    secret_key: str = "change-me-in-production"
    database_path: str = "data/tapmap.db"

    # Crawl defaults
    max_pages_default: int = 200
    max_depth_default: int = 5
    rate_limit_default: float = 1.0
    rate_limit_floor: float = 0.5
    scan_timeout_seconds: int = 900
    user_agent: str = "TapMap/1.0 (internal pharma audit tool)"

    # Session
    session_cookie_name: str = "tapmap_session"
    session_max_age: int = 86400  # 24 hours

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def database_url(self) -> str:
        return str(Path(self.database_path).resolve())


settings = Settings()
