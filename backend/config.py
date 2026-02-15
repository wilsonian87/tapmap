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
    user_agent: str = "TapMapper/1.0 (pharma site audit tool)"

    # Admin
    admin_username: str = ""

    # Session
    session_cookie_name: str = "tapmap_session"
    session_max_age: int = 86400  # 24 hours

    # CORS
    cors_origins: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def database_url(self) -> str:
        return str(Path(self.database_path).resolve())


settings = Settings()
