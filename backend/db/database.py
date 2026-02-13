import aiosqlite
from pathlib import Path

from config import settings

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scans (
    scan_id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    scan_url TEXT NOT NULL,
    crawl_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_pages INTEGER,
    pages_scanned INTEGER DEFAULT 0,
    scan_status TEXT DEFAULT 'pending',
    scan_quality TEXT,
    consent_detected INTEGER DEFAULT 0,
    consent_action TEXT,
    consent_framework TEXT,
    config_max_pages INTEGER,
    config_max_depth INTEGER,
    config_rate_limit REAL,
    robots_txt_found INTEGER,
    robots_txt_respected INTEGER,
    duration_seconds REAL,
    created_by TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS elements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL REFERENCES scans(scan_id),
    page_url TEXT NOT NULL,
    page_title TEXT,
    element_type TEXT NOT NULL,
    action_type TEXT,
    element_text TEXT,
    css_selector TEXT,
    xpath TEXT,
    section_context TEXT,
    container_context TEXT,
    is_above_fold INTEGER,
    target_url TEXT,
    is_external INTEGER,
    pharma_context TEXT,
    notes TEXT,
    value_tier TEXT,
    value_reason TEXT,
    owner TEXT,
    measurement_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_elements_scan_id ON elements(scan_id);
CREATE INDEX IF NOT EXISTS idx_scans_domain ON scans(domain);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(scan_status);
CREATE INDEX IF NOT EXISTS idx_scans_created_by ON scans(created_by);
"""


async def get_db() -> aiosqlite.Connection:
    """Get a database connection. Used as FastAPI dependency."""
    db_path = Path(settings.database_url)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()


async def _migrate_schema(db):
    """Add new columns to existing tables (safe for fresh DBs too)."""
    cursor = await db.execute("PRAGMA table_info(scans)")
    existing = {row[1] for row in await cursor.fetchall()}

    migrations = {
        "analytics_detected": "ALTER TABLE scans ADD COLUMN analytics_detected TEXT",
        "tag_name": "ALTER TABLE scans ADD COLUMN tag_name TEXT DEFAULT 'Pharma'",
        "tag_keywords": "ALTER TABLE scans ADD COLUMN tag_keywords TEXT",
    }
    for col, sql in migrations.items():
        if col not in existing:
            await db.execute(sql)
    await db.commit()


async def init_db():
    """Initialize database schema."""
    db_path = Path(settings.database_url)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(SCHEMA_SQL)
        await _migrate_schema(db)
        await db.commit()
