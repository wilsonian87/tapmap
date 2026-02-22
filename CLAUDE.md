# TapMapper — Project Context for Claude Code

## What This Is
Automated discovery tool for interactive website elements on pharma brand sites. Crawls public US pharma URLs, inventories clickable interactions, exports structured XLSX for HVA/MVA measurement teams. Live at https://tapmapper.com.

## Architecture
Single-stack monorepo: FastAPI backend (Python 3.11+) + React/Vite frontend (TypeScript). SQLite for persistence. Playwright for headless crawling. Deployed on DigitalOcean via Coolify (app UUID: `wcc4sccco4cs8gggg880c8c4`).

## Stack
- **Backend:** FastAPI, Playwright (async Chromium), aiosqlite, bcrypt, pydantic v2
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query v5
- **Database:** SQLite (data/tapmap.db)
- **Auth:** bcrypt + signed httponly session cookies (single superadmin)
- **Export:** openpyxl (XLSX), csv

## Key Directories
```
backend/          Python backend (FastAPI)
  auth/           Authentication (bcrypt, sessions)
  crawler/        Playwright crawl engine, robots.txt, element extraction, consent handling, analytics detection
  export/         XLSX/CSV export
  db/             SQLite schema and connection
  api/            REST API routes (scans, admin, auth, exports)
frontend/         React frontend (Vite)
  src/components/ UI components (ScanDetail, ElementTypeIcon, etc.)
  src/lib/        API client, utilities
data/             SQLite database (gitignored)
tests/            Python tests
```

## Commands
```bash
# Backend
cd backend && uvicorn main:app --reload --port 8000

# Frontend
cd frontend && npm run dev

# Tests
cd backend && python -m pytest ../tests/
```

## Key Features
- **Crawl engine:** Playwright-based, respects robots.txt, handles consent banners, rate-limited, depth/page capped
- **Live scan progress:** In-memory progress registry (`_active_scans` dict in engine.py) polled by frontend every 1.5s via `GET /scans/{id}/progress`. DB flush every 5 pages as fallback.
- **Results table:** Paginated (50/100/200/All), sortable columns (Type, Text, Action, Section, Page, Pharma), expandable detail rows
- **Filtering:** Multi-select type chips (include), exclude dropdowns for Type and Action, search text, pharma-only toggle, "Hide Links" / "Dedup" presets. All filters persisted to URL search params.
- **Group-by views:** Flat table, By Page (collapsible per-URL sections), By Type (collapsible per-type sections)
- **Domain history:** Compare scans over time, diff added/removed elements between any two scans
- **AI classification:** LLM-powered value tier classification (high/medium/low) with manual override
- **Admin panel:** User management, scan lifecycle settings, data purge controls, system stats
- **Export:** XLSX and CSV with optional dedup

## Conventions
- Parameterized SQL queries only (no f-strings for SQL)
- Pydantic models for all API request/response schemas
- robots.txt compliance mandatory — never bypass
- Rate limit floor: 0.5 req/sec (hard minimum)
- User-Agent: "TapMap/1.0 (internal pharma audit tool)"
- All crawl ethics decisions logged in scan records

## Domain Context
Pharma-exclusive tool. Elements like ISI links, PI downloads, adverse event reporting, patient enrollment forms are high-value by default. Flag pharma-specific patterns in extraction output.

## Deployment
Manual build flow (Coolify API is broken):
```bash
ssh root@159.65.172.171 "cd /tmp && git clone --depth 1 https://github.com/wilsonian87/tapmap.git deploy-tmp"
ssh root@159.65.172.171 "cd /tmp/deploy-tmp && docker build -t wcc4sccco4cs8gggg880c8c4:COMMIT_SHA ."
# Update image tag in /data/coolify/applications/wcc4sccco4cs8gggg880c8c4/docker-compose.yaml
ssh root@159.65.172.171 "cd /data/coolify/applications/wcc4sccco4cs8gggg880c8c4 && docker compose up -d --force-recreate"
ssh root@159.65.172.171 "rm -rf /tmp/deploy-tmp"
```

## Current Phase
V2.5 complete — Live scan progress, table pagination/sorting, multi-select filters with URL persistence, exclude filters, group-by views, element type icons, page path display. All deployed to production.
