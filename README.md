# TapMap

Automated discovery of interactive website elements on pharma brand sites. Crawls public URLs, inventories clickable interactions (links, buttons, forms, menus, tabs, accordions), and exports structured XLSX for HVA/MVA measurement teams.

## Features

- Headless browser crawling with Playwright (handles JS-rendered SPAs)
- Cookie/consent banner detection and dismissal (OneTrust, TrustArc, Cookiebot, Didomi)
- Pharma-specific context flagging (ISI, adverse events, patient enrollment, HCP gates, fair balance)
- robots.txt compliance with configurable rate limiting
- XLSX export with formatted headers, filters, and pharma highlighting
- CSV export for downstream tooling
- Real-time scan progress in the UI

## Quick Start (Local)

### Prerequisites

- Python 3.11+
- Node.js 18+

### Setup

```bash
# Clone and enter project
git clone <repo-url> && cd tapmap

# Create Python venv and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
playwright install chromium

# Install frontend dependencies
cd frontend && npm install && cd ..

# Copy environment config
cp .env.example backend/.env
```

### Run

```bash
# Terminal 1: Backend
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2: Frontend dev server
cd frontend && npm run dev
```

Open http://localhost:5173, register an account, and submit a pharma URL.

### Run Tests

```bash
source .venv/bin/activate
cd backend && python -m pytest ../tests/ -v
```

## Docker

```bash
# Build and run
docker compose up --build

# Access at http://localhost:8000
```

Set `SECRET_KEY` in your environment or a `.env` file before running in production.

## Configuration

All settings are configurable via environment variables (or a `.env` file in `backend/`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `change-me-in-production` | Session signing key |
| `DATABASE_PATH` | `data/tapmap.db` | SQLite database path |
| `MAX_PAGES_DEFAULT` | `200` | Default max pages per scan |
| `MAX_DEPTH_DEFAULT` | `5` | Default max crawl depth |
| `RATE_LIMIT_DEFAULT` | `1.0` | Default requests/second |
| `SCAN_TIMEOUT_SECONDS` | `900` | Hard scan timeout (15 min) |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins (comma-separated) |

## Architecture

Single-stack monorepo: FastAPI backend + React/Vite frontend.

- **Backend:** FastAPI, Playwright (async Chromium), aiosqlite, bcrypt
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, TanStack Query
- **Database:** SQLite
- **Export:** openpyxl (XLSX), csv

The frontend builds to static files that FastAPI serves in production. In development, Vite's dev server proxies API calls to the backend.

## Crawl Ethics

- robots.txt is always checked and respected
- Rate limit floor: 0.5 requests/second (cannot be lowered)
- User-Agent clearly identifies the tool: `TapMap/1.0 (internal pharma audit tool)`
- Only public, same-domain pages are crawled
- SSRF protection blocks scans of private/localhost addresses
