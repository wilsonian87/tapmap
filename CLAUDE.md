# TapMap — Project Context for Claude Code

## What This Is
Automated discovery tool for interactive website elements on pharma brand sites. Crawls public US pharma URLs, inventories clickable interactions, exports structured XLSX for HVA/MVA measurement teams.

## Architecture
Single-stack monorepo: FastAPI backend (Python 3.11+) + React/Vite frontend (TypeScript). SQLite for persistence. Playwright for headless crawling.

## Stack
- **Backend:** FastAPI, Playwright (async Chromium), aiosqlite, bcrypt, pydantic v2
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query v5
- **Database:** SQLite (data/tapmap.db)
- **Auth:** bcrypt + signed httponly session cookies
- **Export:** openpyxl (XLSX), csv

## Key Directories
```
backend/          Python backend (FastAPI)
  auth/           Authentication (bcrypt, sessions)
  crawler/        Playwright crawl engine, robots.txt, element extraction
  export/         XLSX/CSV export
  db/             SQLite schema and connection
  api/            REST API routes
frontend/         React frontend (Vite)
  src/components/ UI components
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

## Conventions
- Parameterized SQL queries only (no f-strings for SQL)
- Pydantic models for all API request/response schemas
- robots.txt compliance mandatory — never bypass
- Rate limit floor: 0.5 req/sec (hard minimum)
- User-Agent: "TapMap/1.0 (internal pharma audit tool)"
- All crawl ethics decisions logged in scan records

## Domain Context
Pharma-exclusive tool. Elements like ISI links, PI downloads, adverse event reporting, patient enrollment forms are high-value by default. Flag pharma-specific patterns in extraction output.

## Current Phase
Phase 4 complete — All build phases delivered. MVP ready for deployment.
