# Persistence Upgrade & Feature Expansion — Design Document

## Overview

Upgrade the competitive radar from an in-memory, file-based system to a fully persistent PostgreSQL-backed intelligence platform. Add a signals list page, AI-powered web page monitoring, stored briefings, and prepare for Railway deployment.

## Decisions

- **Database**: PostgreSQL (Railway native plugin)
- **Web monitoring**: AI-powered analysis (Claude summarizes what changed)
- **Background polling**: Server-side, scheduled (every 30 min default)
- **Architecture**: Modularize backend into routes/services/models; frontend stays single HTML
- **Signals page**: Rich filtering (quadrant, competitor, relevance, date, source type, keyword search)
- **Briefings**: Stored and browsable (archive of past briefings)

## Database Schema

| Table | Purpose |
|-------|---------|
| `sources` | All monitored sources (RSS feeds + web pages), type, URL, competitor linkage, polling config |
| `signals` | Every classified item — title, link, pubDate, quadrant, relevance, label, source_id, snippet |
| `web_snapshots` | Content snapshots for monitored web pages — hash, extracted text, timestamp |
| `briefings` | Stored AI briefings — timestamp, content (markdown), metadata |
| `competitors` | Competitor profiles — name, key, description |
| `scan_runs` | Audit log of polling/classification runs — timestamp, items found, items classified |

Relationships: `signals → sources → competitors`, `web_snapshots → sources`, `briefings` standalone.

## Backend Modularization

```
server.js              → slim entry point (Express setup, middleware, start)
src/
  config.js            → env vars, DB connection string, API keys
  db/
    connection.js      → pg Pool setup
    migrate.js         → schema migrations runner
    migrations/        → 001_initial.sql, etc.
  models/
    sources.js         → CRUD for sources
    signals.js         → CRUD + filtered queries
    competitors.js     → CRUD for competitors
    briefings.js       → CRUD for briefings
    webSnapshots.js    → CRUD for snapshots
  services/
    feedService.js     → RSS fetching (extracted from server.js)
    classificationService.js → Claude classification (extracted)
    webMonitorService.js     → Fetch page, diff, AI summarize
    pollingService.js  → Background scheduler (node-cron)
    briefingService.js → Generate + store briefings
  routes/
    radar.js           → GET /api/radar
    signals.js         → GET /api/signals (filtered/paginated)
    sources.js         → CRUD endpoints
    briefings.js       → GET /api/briefings, GET /api/briefings/:id
    competitors.js     → CRUD for competitors
```

## Web Monitoring Flow

1. User adds a URL as a "web monitor" source
2. `pollingService` checks on schedule (default 30 min)
3. `webMonitorService` fetches page with `cheerio`, extracts text content
4. Compares SHA-256 hash against last `web_snapshots` entry
5. If changed → sends old + new text to Claude for AI-powered diff summary
6. Summary becomes a signal (quadrant inferred, relevance AI-scored)
7. Signal stored in DB, appears on radar + signals list

## Signals List Page

- Paginated table/card list of all signals from DB
- Filter bar: quadrant, competitor, source type (RSS/web), relevance range, date range, keyword search
- Sort by: date (default), relevance
- Click signal → opens source link
- Shows total count + active filter summary

## Frontend Navigation

Three views: Radar (default) | Signals | Dashboard
- Header buttons to switch views
- Sources overlay remains a modal
- Briefings button shows stored briefings list

## Railway Deployment

- `Dockerfile` or `railway.json` for build config
- PostgreSQL via Railway plugin (`DATABASE_URL`)
- Environment variables: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PORT`
- Migrations run on startup
- `npm start` entry point
