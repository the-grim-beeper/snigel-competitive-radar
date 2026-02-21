# Persistence Upgrade & Feature Expansion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the in-memory, file-based competitive radar into a PostgreSQL-backed intelligence platform with signals list, web monitoring, and Railway deployment readiness.

**Architecture:** Modularize the monolithic `server.js` (1152 lines) into `src/` with config, db, models, services, and routes. Replace file-based sources/briefs storage with PostgreSQL. Add background polling with `node-cron`, web page monitoring with `cheerio`, and a new signals list view in the frontend.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), `node-cron`, `cheerio`, `crypto` (built-in), Canvas 2D (existing)

---

### Task 1: Foundation — Dependencies, Config, DB Connection & Migration System

**Files:**
- Modify: `package.json`
- Create: `src/config.js`
- Create: `src/db/connection.js`
- Create: `src/db/migrate.js`
- Create: `src/db/migrations/001_initial.sql`

**Step 1: Install new dependencies**

```bash
cd /Users/nicklaslundblad/projects/snigel-competitive-radar
npm install pg node-cron cheerio
```

These add:
- `pg` — PostgreSQL client
- `node-cron` — Background job scheduler
- `cheerio` — HTML parsing for web monitoring

**Step 2: Create `src/config.js`**

```javascript
// src/config.js
const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/snigel_radar',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  cacheTtlMs: 15 * 60 * 1000,       // 15 minutes
  radarChunkSize: 40,
  pollIntervalMinutes: 30,
};

module.exports = config;
```

**Step 3: Create `src/db/connection.js`**

```javascript
// src/db/connection.js
const { Pool } = require('pg');
const config = require('../config');

const poolConfig = { connectionString: config.databaseUrl };
if (config.databaseUrl.includes('railway') || process.env.RAILWAY_ENVIRONMENT) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

module.exports = pool;
```

**Step 4: Create `src/db/migrate.js`**

```javascript
// src/db/migrate.js
const fs = require('fs');
const path = require('path');
const pool = require('./connection');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length > 0) continue;

    console.log(`[migrate] Applying ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    console.log(`[migrate] Applied ${file}`);
  }
}

module.exports = migrate;
```

**Step 5: Create `src/db/migrations/001_initial.sql`**

```sql
-- Competitors
CREATE TABLE competitors (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  flag TEXT,
  founded INT,
  revenue TEXT,
  employees TEXT,
  hq TEXT,
  threat TEXT DEFAULT 'medium',
  color TEXT,
  focus TEXT[] DEFAULT '{}',
  channels TEXT,
  radar_angle REAL,
  radar_dist REAL,
  capabilities JSONB DEFAULT '{}',
  swot JSONB DEFAULT '{}',
  timeline JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sources (RSS feeds + web monitors)
CREATE TABLE sources (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('rss', 'web_monitor')),
  url TEXT NOT NULL,
  name TEXT,
  competitor_key TEXT REFERENCES competitors(key) ON DELETE SET NULL,
  category TEXT DEFAULT 'industry',
  poll_interval_minutes INT DEFAULT 30,
  last_polled_at TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sources_type ON sources(type);
CREATE INDEX idx_sources_competitor ON sources(competitor_key);

-- Signals (classified feed/monitor items)
CREATE TABLE signals (
  id SERIAL PRIMARY KEY,
  source_id INT REFERENCES sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  link TEXT,
  pub_date TIMESTAMPTZ,
  snippet TEXT,
  quadrant TEXT NOT NULL CHECK (quadrant IN ('competitors', 'industry', 'snigel', 'anomalies')),
  relevance INT NOT NULL CHECK (relevance BETWEEN 1 AND 10),
  label TEXT,
  source_name TEXT,
  source_type TEXT,
  source_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_signals_quadrant ON signals(quadrant);
CREATE INDEX idx_signals_relevance ON signals(relevance);
CREATE INDEX idx_signals_pub_date ON signals(pub_date);
CREATE INDEX idx_signals_source_key ON signals(source_key);
CREATE UNIQUE INDEX idx_signals_link ON signals(link) WHERE link IS NOT NULL;

-- Web snapshots (for change detection)
CREATE TABLE web_snapshots (
  id SERIAL PRIMARY KEY,
  source_id INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  extracted_text TEXT,
  diff_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_snapshots_source ON web_snapshots(source_id);

-- Briefings (stored AI intelligence briefs)
CREATE TABLE briefings (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  model TEXT,
  input_tokens INT,
  output_tokens INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_briefings_created ON briefings(created_at DESC);

-- Scan runs (audit log)
CREATE TABLE scan_runs (
  id SERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  items_found INT DEFAULT 0,
  items_classified INT DEFAULT 0,
  errors TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 6: Verify — start with local PostgreSQL**

```bash
createdb snigel_radar
DATABASE_URL=postgresql://localhost:5432/snigel_radar node -e "require('./src/db/migrate')().then(() => { console.log('OK'); process.exit(0); })"
```

Expected: prints `[migrate] Applying 001_initial.sql...` then `OK`.

**Step 7: Commit**

```bash
git add package.json package-lock.json src/config.js src/db/
git commit -m "feat: add PostgreSQL foundation — config, connection pool, migration system"
```

---

### Task 2: Models Layer — CRUD for All 6 Tables

**Files:**
- Create: `src/models/competitors.js`
- Create: `src/models/sources.js`
- Create: `src/models/signals.js`
- Create: `src/models/briefings.js`
- Create: `src/models/webSnapshots.js`
- Create: `src/models/scanRuns.js`

**Step 1: Create `src/models/competitors.js`**

```javascript
const pool = require('../db/connection');

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM competitors ORDER BY name');
  return rows;
}

async function getByKey(key) {
  const { rows } = await pool.query('SELECT * FROM competitors WHERE key = $1', [key]);
  return rows[0] || null;
}

async function upsert(key, data) {
  const { name, country, flag, founded, revenue, employees, hq, threat, color, focus, channels, radar_angle, radar_dist, capabilities, swot, timeline } = data;
  const { rows } = await pool.query(`
    INSERT INTO competitors (key, name, country, flag, founded, revenue, employees, hq, threat, color, focus, channels, radar_angle, radar_dist, capabilities, swot, timeline)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (key) DO UPDATE SET
      name=EXCLUDED.name, country=EXCLUDED.country, flag=EXCLUDED.flag, founded=EXCLUDED.founded,
      revenue=EXCLUDED.revenue, employees=EXCLUDED.employees, hq=EXCLUDED.hq, threat=EXCLUDED.threat,
      color=EXCLUDED.color, focus=EXCLUDED.focus, channels=EXCLUDED.channels,
      radar_angle=EXCLUDED.radar_angle, radar_dist=EXCLUDED.radar_dist,
      capabilities=EXCLUDED.capabilities, swot=EXCLUDED.swot, timeline=EXCLUDED.timeline,
      updated_at=NOW()
    RETURNING *
  `, [key, name, country, flag, founded, revenue, employees, hq, threat, color, focus || [], channels, radar_angle, radar_dist, capabilities || {}, swot || {}, timeline || '[]']);
  return rows[0];
}

async function remove(key) {
  await pool.query('DELETE FROM competitors WHERE key = $1', [key]);
}

module.exports = { getAll, getByKey, upsert, remove };
```

**Step 2: Create `src/models/sources.js`**

```javascript
const pool = require('../db/connection');

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM sources WHERE enabled = TRUE ORDER BY category, name');
  return rows;
}

async function getByType(type) {
  const { rows } = await pool.query('SELECT * FROM sources WHERE type = $1 AND enabled = TRUE', [type]);
  return rows;
}

async function getByCompetitor(competitorKey) {
  const { rows } = await pool.query('SELECT * FROM sources WHERE competitor_key = $1 AND enabled = TRUE', [competitorKey]);
  return rows;
}

async function getCompetitorSources() {
  const { rows } = await pool.query("SELECT * FROM sources WHERE category = 'competitor' AND enabled = TRUE ORDER BY competitor_key");
  return rows;
}

async function getIndustrySources() {
  const { rows } = await pool.query("SELECT * FROM sources WHERE category = 'industry' AND enabled = TRUE ORDER BY name");
  return rows;
}

async function create(data) {
  const { type, url, name, competitor_key, category, poll_interval_minutes } = data;
  const { rows } = await pool.query(`
    INSERT INTO sources (type, url, name, competitor_key, category, poll_interval_minutes)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [type || 'rss', url, name, competitor_key, category || 'industry', poll_interval_minutes || 30]);
  return rows[0];
}

async function update(id, data) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i}`);
    values.push(val);
    i++;
  }
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE sources SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0];
}

async function remove(id) {
  await pool.query('DELETE FROM sources WHERE id = $1', [id]);
}

async function removeByUrl(url) {
  await pool.query('DELETE FROM sources WHERE url = $1', [url]);
}

async function findByUrl(url) {
  const { rows } = await pool.query('SELECT * FROM sources WHERE url = $1', [url]);
  return rows[0] || null;
}

async function markPolled(id) {
  await pool.query('UPDATE sources SET last_polled_at = NOW() WHERE id = $1', [id]);
}

module.exports = { getAll, getByType, getByCompetitor, getCompetitorSources, getIndustrySources, create, update, remove, removeByUrl, findByUrl, markPolled };
```

**Step 3: Create `src/models/signals.js`**

```javascript
const pool = require('../db/connection');

async function create(signal) {
  const { source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key } = signal;
  const { rows } = await pool.query(`
    INSERT INTO signals (source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (link) WHERE link IS NOT NULL DO NOTHING
    RETURNING *
  `, [source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key]);
  return rows[0] || null;
}

async function createBatch(signals) {
  if (!signals.length) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const s of signals) {
      const { rows } = await client.query(`
        INSERT INTO signals (source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (link) WHERE link IS NOT NULL DO NOTHING
        RETURNING *
      `, [s.source_id, s.title, s.link, s.pub_date, s.snippet, s.quadrant, s.relevance, s.label, s.source_name, s.source_type, s.source_key]);
      if (rows[0]) results.push(rows[0]);
    }
    await client.query('COMMIT');
    return results;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function query({ quadrant, source_key, source_type, min_relevance, max_relevance, from_date, to_date, search, sort_by, sort_dir, limit, offset } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (quadrant) { conditions.push(`quadrant = $${i++}`); values.push(quadrant); }
  if (source_key) { conditions.push(`source_key = $${i++}`); values.push(source_key); }
  if (source_type) { conditions.push(`source_type = $${i++}`); values.push(source_type); }
  if (min_relevance) { conditions.push(`relevance >= $${i++}`); values.push(min_relevance); }
  if (max_relevance) { conditions.push(`relevance <= $${i++}`); values.push(max_relevance); }
  if (from_date) { conditions.push(`pub_date >= $${i++}`); values.push(from_date); }
  if (to_date) { conditions.push(`pub_date <= $${i++}`); values.push(to_date); }
  if (search) { conditions.push(`(title ILIKE $${i} OR label ILIKE $${i})`); values.push(`%${search}%`); i++; }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderCol = sort_by === 'relevance' ? 'relevance' : 'pub_date';
  const orderDir = sort_dir === 'asc' ? 'ASC' : 'DESC';
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  const countResult = await pool.query(`SELECT COUNT(*) FROM signals ${where}`, values);
  const total = parseInt(countResult.rows[0].count, 10);

  values.push(lim, off);
  const { rows } = await pool.query(
    `SELECT * FROM signals ${where} ORDER BY ${orderCol} ${orderDir} NULLS LAST LIMIT $${i++} OFFSET $${i++}`,
    values
  );

  return { items: rows, total, limit: lim, offset: off };
}

async function getRecent(hours = 24) {
  const { rows } = await pool.query(
    `SELECT * FROM signals WHERE created_at > NOW() - INTERVAL '1 hour' * $1 ORDER BY pub_date DESC`,
    [hours]
  );
  return rows;
}

async function existsByLink(link) {
  if (!link) return false;
  const { rows } = await pool.query('SELECT 1 FROM signals WHERE link = $1 LIMIT 1', [link]);
  return rows.length > 0;
}

module.exports = { create, createBatch, query, getRecent, existsByLink };
```

**Step 4: Create `src/models/briefings.js`**

```javascript
const pool = require('../db/connection');

async function create(data) {
  const { content, model, input_tokens, output_tokens } = data;
  const { rows } = await pool.query(`
    INSERT INTO briefings (content, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4) RETURNING *
  `, [content, model, input_tokens, output_tokens]);
  return rows[0];
}

async function getAll(limit = 20) {
  const { rows } = await pool.query('SELECT id, created_at, input_tokens, output_tokens FROM briefings ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM briefings WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getRecent(count = 3) {
  const { rows } = await pool.query('SELECT content, created_at FROM briefings ORDER BY created_at DESC LIMIT $1', [count]);
  return rows;
}

module.exports = { create, getAll, getById, getRecent };
```

**Step 5: Create `src/models/webSnapshots.js`**

```javascript
const pool = require('../db/connection');

async function create(data) {
  const { source_id, content_hash, extracted_text, diff_summary } = data;
  const { rows } = await pool.query(`
    INSERT INTO web_snapshots (source_id, content_hash, extracted_text, diff_summary)
    VALUES ($1,$2,$3,$4) RETURNING *
  `, [source_id, content_hash, extracted_text, diff_summary]);
  return rows[0];
}

async function getLatest(sourceId) {
  const { rows } = await pool.query(
    'SELECT * FROM web_snapshots WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sourceId]
  );
  return rows[0] || null;
}

module.exports = { create, getLatest };
```

**Step 6: Create `src/models/scanRuns.js`**

```javascript
const pool = require('../db/connection');

async function create(data) {
  const { run_type, items_found, items_classified, errors, duration_ms } = data;
  const { rows } = await pool.query(`
    INSERT INTO scan_runs (run_type, items_found, items_classified, errors, duration_ms)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [run_type, items_found || 0, items_classified || 0, errors, duration_ms]);
  return rows[0];
}

async function getRecent(limit = 10) {
  const { rows } = await pool.query('SELECT * FROM scan_runs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

module.exports = { create, getRecent };
```

**Step 7: Verify models load without error**

```bash
node -e "
const competitors = require('./src/models/competitors');
const sources = require('./src/models/sources');
const signals = require('./src/models/signals');
const briefings = require('./src/models/briefings');
const webSnapshots = require('./src/models/webSnapshots');
const scanRuns = require('./src/models/scanRuns');
console.log('All models loaded OK');
process.exit(0);
"
```

Expected: `All models loaded OK`

**Step 8: Commit**

```bash
git add src/models/
git commit -m "feat: add model layer for all 6 database tables"
```

---

### Task 3: Extract Services from server.js

Extract the core business logic from `server.js` into service modules. After this task, `server.js` still works exactly as before but delegates to services.

**Files:**
- Create: `src/services/feedService.js`
- Create: `src/services/classificationService.js`
- Modify: `server.js` — replace inline logic with service calls

**Step 1: Create `src/services/feedService.js`**

Extract `fetchFeed()` (server.js:258-273), `fetchCompetitorFeeds()` (server.js:275-312), `fetchIndustryFeeds()` (server.js:314-339).

```javascript
// src/services/feedService.js
const RSSParser = require('rss-parser');
const config = require('../config');

const parser = new RSSParser({ timeout: 10000 });

const cache = {
  competitors: { data: null, timestamp: 0 },
  industry: { data: null, timestamp: 0 },
};

function isCacheValid(key) {
  return cache[key].data && (Date.now() - cache[key].timestamp < config.cacheTtlMs);
}

function invalidateCache() {
  cache.competitors = { data: null, timestamp: 0 };
  cache.industry = { data: null, timestamp: 0 };
}

async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).map(item => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || '',
      snippet: (item.contentSnippet || item.content || '').slice(0, 200),
    }));
  } catch (e) {
    console.error(`[feed] Error fetching ${url}: ${e.message}`);
    return [];
  }
}

async function fetchCompetitorFeeds(sources) {
  if (isCacheValid('competitors')) return cache.competitors.data;

  const competitors = sources.competitors || {};
  const results = {};

  await Promise.all(Object.entries(competitors).map(async ([key, comp]) => {
    const items = [];
    for (const url of (comp.feeds || [])) {
      const feedItems = await fetchFeed(url);
      feedItems.forEach(item => {
        item.source = comp.name || key;
        item._sourceType = 'competitor';
        item._sourceKey = key;
        item._sourceName = comp.name || key;
      });
      items.push(...feedItems);
    }
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    results[key] = items.slice(0, 15);
  }));

  cache.competitors = { data: results, timestamp: Date.now() };
  return results;
}

async function fetchIndustryFeeds(sources) {
  if (isCacheValid('industry')) return cache.industry.data;

  const urls = sources.industry || [];
  const allItems = [];

  await Promise.all(urls.map(async (url) => {
    const items = await fetchFeed(url);
    items.forEach(item => {
      item.source = 'Industry';
      item._sourceType = 'industry';
      item._sourceKey = null;
      item._sourceName = 'Industry';
    });
    allItems.push(...items);
  }));

  const seen = new Set();
  const deduped = allItems.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
  deduped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const result = deduped.slice(0, 30);

  cache.industry = { data: result, timestamp: Date.now() };
  return result;
}

module.exports = { fetchFeed, fetchCompetitorFeeds, fetchIndustryFeeds, invalidateCache };
```

**Step 2: Create `src/services/classificationService.js`**

Extract `classifyRadarItems()` from server.js:342-439.

```javascript
// src/services/classificationService.js
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

const anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

async function classifyRadarItems(allItems) {
  if (!anthropic) {
    return allItems.map(item => ({
      ...item,
      quadrant: item._sourceType === 'competitor' ? 'competitors' :
                item._sourceType === 'snigel' ? 'snigel' : 'industry',
      relevance: 5,
      label: (item.title || '').slice(0, 40),
    }));
  }

  const CHUNK_SIZE = config.radarChunkSize;
  const chunks = [];
  for (let i = 0; i < allItems.length; i += CHUNK_SIZE) {
    chunks.push(allItems.slice(i, i + CHUNK_SIZE));
  }

  const chunkResults = await Promise.all(chunks.map(async (chunk, ci) => {
    const itemSummaries = chunk.map((item, idx) => {
      const globalIdx = ci * CHUNK_SIZE + idx;
      return `[${globalIdx}] (${item._sourceType}/${item._sourceKey || 'n/a'}) ${item.title}\n    ${(item.snippet || '').slice(0, 150)}`;
    }).join('\n');

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4000,
        system: `You are a competitive intelligence classifier for Snigel Design AB, a Swedish manufacturer of tactical/military gear (body armor carriers, pouches, packs, combat clothing). Classify each news item into one of 4 quadrants and assign a relevance score.

Quadrants:
- "competitors" — News about tracked competitors (NFM, Mehler, Lindnerhof, Tasmanian Tiger, UF PRO, Savotta, etc.)
- "industry" — Defense procurement, trade shows, regulations, market trends
- "snigel" — News mentioning Snigel Design directly
- "anomalies" — Unexpected signals, cross-cutting trends, or items that don't fit other quadrants

Relevance (integer 1-10):
10 = Directly actionable intelligence
7-9 = Highly relevant to Snigel's competitive position
4-6 = Moderately relevant industry context
1-3 = Low relevance / tangential

Output: raw JSON array only, no markdown. Each element: {"index": N, "quadrant": "...", "relevance": N, "label": "3-6 word summary"}`,
        messages: [{ role: 'user', content: `Classify these items:\n\n${itemSummaries}` }],
      });

      const text = resp.content[0].text.trim();
      const parsed = JSON.parse(text);
      return parsed.map(cl => {
        const item = allItems[cl.index] || {};
        return {
          ...item,
          quadrant: cl.quadrant || 'anomalies',
          relevance: Math.max(1, Math.min(10, Math.round(cl.relevance) || 5)),
          label: cl.label || (item.title || '').slice(0, 40),
        };
      });
    } catch (e) {
      console.error(`[classify] Chunk ${ci} error: ${e.message}`);
      return chunk.map(item => ({
        ...item,
        quadrant: item._sourceType === 'competitor' ? 'competitors' : 'industry',
        relevance: 5,
        label: (item.title || '').slice(0, 40),
      }));
    }
  }));

  return chunkResults.flat();
}

module.exports = { classifyRadarItems };
```

**Step 3: Update `server.js` to use services**

1. Add at top: `const feedService = require('./src/services/feedService');`
2. Add: `const classificationService = require('./src/services/classificationService');`
3. Replace inline `fetchFeed`, `fetchCompetitorFeeds`, `fetchIndustryFeeds` calls with `feedService.*`
4. Replace inline `classifyRadarItems` with `classificationService.classifyRadarItems`
5. On source update (cache invalidation): call `feedService.invalidateCache()`
6. Delete the extracted functions from server.js (approximately lines 258-439)
7. Keep the `cache.radar` object in server.js for radar route caching (this is separate from feed caching)

**Step 4: Verify server still works**

```bash
node server.js
# In another terminal:
curl http://localhost:3000/api/status
curl http://localhost:3000/api/sources
curl http://localhost:3000/api/radar | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d.get(\"items\",[]))} items')"
```

Expected: all endpoints return same data as before.

**Step 5: Commit**

```bash
git add src/services/feedService.js src/services/classificationService.js server.js
git commit -m "refactor: extract feed and classification services from server.js"
```

---

### Task 4: Extract Routes into Separate Files

Move route handlers from `server.js` into `src/routes/` modules. After this, `server.js` is a slim ~80-line entry point.

**Files:**
- Create: `src/routes/radar.js`
- Create: `src/routes/feeds.js`
- Create: `src/routes/sources.js`
- Create: `src/routes/briefings.js`
- Create: `src/routes/profiles.js`
- Create: `src/routes/status.js`
- Modify: `server.js` — slim down to setup + route mounting + startup

**Step 1: Create route files**

Each route file exports an Express `Router`. Move the corresponding route handlers from `server.js`. Important patterns:

- File-based `loadSources()`/`saveSources()` should be accessed via `req.app.locals` so routes don't import filesystem code directly
- Similarly for `loadProfiles()`/`saveProfiles()`
- The Anthropic client is used in briefings, sources/suggest, sources/search, and profiles/scan routes — pass via `req.app.locals.anthropic` or create a shared module

**`src/routes/radar.js`**: Move GET `/api/radar` handler (server.js:512-548). Use `feedService` and `classificationService` imports.

**`src/routes/feeds.js`**: Move GET `/api/feeds/competitors`, `/api/feeds/industry`, `/api/feeds/all` (server.js:444-488).

**`src/routes/sources.js`**: Move all `/api/sources/*` routes (server.js:551-805). This includes the AI suggestion and feed search routes.

**`src/routes/briefings.js`**: Move GET `/api/brief` (streaming), GET `/api/briefs`, GET `/api/briefs/:id` (server.js:943-1125).

**`src/routes/profiles.js`**: Move all `/api/profiles/*` routes (server.js:806-940). This includes the AI competitor scan.

**`src/routes/status.js`**: Move GET `/api/status` (server.js:490-509).

**Step 2: Slim down `server.js`**

```javascript
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./src/config');
const migrate = require('./src/db/migrate');

const fs = require('fs');
const SOURCES_PATH = path.join(__dirname, 'data', 'sources.json');
const PROFILES_PATH = path.join(__dirname, 'data', 'profiles.json');
const BRIEFS_DIR = path.join(__dirname, 'data', 'briefs');
const DEFAULT_SOURCES = { /* existing defaults from current server.js */ };

function loadSources() {
  try { return JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')); }
  catch { return DEFAULT_SOURCES; }
}
function saveSources(s) { fs.writeFileSync(SOURCES_PATH, JSON.stringify(s, null, 2)); }
function loadProfiles() {
  try { return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8')); }
  catch { return null; }
}
function saveProfiles(p) { fs.writeFileSync(PROFILES_PATH, JSON.stringify(p, null, 2)); }
function ensureBriefsDir() { if (!fs.existsSync(BRIEFS_DIR)) fs.mkdirSync(BRIEFS_DIR, { recursive: true }); }

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Shared state for routes
app.locals.loadSources = loadSources;
app.locals.saveSources = saveSources;
app.locals.loadProfiles = loadProfiles;
app.locals.saveProfiles = saveProfiles;
app.locals.ensureBriefsDir = ensureBriefsDir;
app.locals.briefsDir = BRIEFS_DIR;
app.locals.anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

// Mount routes
app.use('/api', require('./src/routes/radar').router);
app.use('/api', require('./src/routes/feeds').router);
app.use('/api', require('./src/routes/sources').router);
app.use('/api', require('./src/routes/briefings').router);
app.use('/api', require('./src/routes/profiles').router);
app.use('/api', require('./src/routes/status').router);

async function start() {
  try {
    await migrate();
    console.log('[db] Migrations complete');
  } catch (e) {
    console.warn('[db] Migration skipped:', e.message);
  }

  app.listen(config.port, () => {
    console.log(`\n  SNIGEL COMPETITIVE RADAR`);
    console.log(`  http://localhost:${config.port}\n`);
  });

  // Pre-warm feeds
  setTimeout(async () => {
    try {
      const feedService = require('./src/services/feedService');
      const sources = loadSources();
      await feedService.fetchCompetitorFeeds(sources);
      await feedService.fetchIndustryFeeds(sources);
      console.log('[startup] Feed cache warmed');
    } catch (e) {
      console.error('[startup] Feed warm error:', e.message);
    }
  }, 2000);
}

start();
```

**Step 3: Verify all endpoints still work**

```bash
node server.js
curl http://localhost:3000/api/status
curl http://localhost:3000/api/sources
curl "http://localhost:3000/api/feeds/all" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK')"
# Open browser to http://localhost:3000 — full radar should work
```

**Step 4: Commit**

```bash
git add server.js src/routes/
git commit -m "refactor: extract all routes into src/routes/ — server.js is now slim entry point"
```

---

### Task 5: Sources Persistence — Migrate from File to Database

Replace `data/sources.json` with PostgreSQL storage. Seed the DB from the existing file on first run.

**Files:**
- Create: `src/services/seedService.js`
- Modify: `src/routes/sources.js` — use models instead of file I/O
- Modify: `server.js` — run seed, update `loadSources` to use DB

**Step 1: Create `src/services/seedService.js`**

```javascript
const fs = require('fs');
const path = require('path');
const pool = require('../db/connection');
const competitorsModel = require('../models/competitors');
const sourcesModel = require('../models/sources');

async function seedFromFile() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM sources');
  if (parseInt(rows[0].count, 10) > 0) {
    console.log('[seed] Database already has sources, skipping seed');
    return;
  }

  const filePath = path.join(__dirname, '../../data/sources.json');
  if (!fs.existsSync(filePath)) {
    console.log('[seed] No sources.json found, skipping seed');
    return;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log('[seed] Seeding database from sources.json...');

  for (const [key, comp] of Object.entries(data.competitors || {})) {
    await competitorsModel.upsert(key, { name: comp.name || key });
    for (const url of (comp.feeds || [])) {
      await sourcesModel.create({
        type: 'rss',
        url,
        name: comp.name || key,
        competitor_key: key,
        category: 'competitor',
      });
    }
  }

  for (const url of (data.industry || [])) {
    await sourcesModel.create({
      type: 'rss',
      url,
      name: 'Industry',
      category: 'industry',
    });
  }

  console.log('[seed] Seeding complete');
}

module.exports = { seedFromFile };
```

**Step 2: Create `src/helpers/legacyFormat.js`**

The frontend still expects sources in the old `{ competitors: { key: { name, feeds[] } }, industry: [urls] }` format. Provide a helper to convert from DB:

```javascript
const competitorsModel = require('../models/competitors');
const sourcesModel = require('../models/sources');

async function getLegacySourcesFormat() {
  const allSources = await sourcesModel.getAll();
  const allCompetitors = await competitorsModel.getAll();

  const competitors = {};
  for (const comp of allCompetitors) {
    const feeds = allSources
      .filter(s => s.competitor_key === comp.key && s.type === 'rss')
      .map(s => s.url);
    if (feeds.length > 0 || comp.key) {
      competitors[comp.key] = { name: comp.name, feeds };
    }
  }

  const industry = allSources
    .filter(s => s.category === 'industry' && s.type === 'rss')
    .map(s => s.url);

  return { competitors, industry };
}

module.exports = { getLegacySourcesFormat };
```

**Step 3: Update `src/routes/sources.js` to use DB models**

Replace all file-based `loadSources()`/`saveSources()` calls with model operations. Use `getLegacySourcesFormat()` for GET `/api/sources` to maintain frontend compatibility.

For PUT `/api/sources` — this is a full replacement. Parse the incoming format and sync to DB.

For POST `/api/sources/add-competitor` — use `competitorsModel.upsert()` + `sourcesModel.create()`.

For DELETE `/api/sources/competitor/:key` — use `competitorsModel.remove()` (cascades via FK).

For POST `/api/sources/add-industry` — use `sourcesModel.create()`.

For DELETE `/api/sources/industry` — use `sourcesModel.removeByUrl()`.

Don't forget to call `feedService.invalidateCache()` after any source changes.

**Step 4: Update server.js**

Update `app.locals.loadSources` to be async and use DB:

```javascript
const { getLegacySourcesFormat } = require('./src/helpers/legacyFormat');
const { seedFromFile } = require('./src/services/seedService');

// In start():
await migrate();
await seedFromFile();

// Replace loadSources
app.locals.loadSources = getLegacySourcesFormat;
```

Note: since `loadSources` is now async, update all callers (in routes/radar.js, routes/feeds.js) to `await req.app.locals.loadSources()`.

**Step 5: Verify**

```bash
# Reset DB sources to trigger seed
DATABASE_URL=postgresql://localhost:5432/snigel_radar node -e "require('./src/db/connection').query('DELETE FROM sources; DELETE FROM competitors;').then(() => process.exit(0))"

node server.js
# Should see: [seed] Seeding database from sources.json...

curl http://localhost:3000/api/sources | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d[\"competitors\"])} competitors, {len(d[\"industry\"])} industry')"
```

Expected: `11 competitors, 5 industry feeds`

**Step 6: Commit**

```bash
git add src/services/seedService.js src/helpers/legacyFormat.js src/routes/sources.js server.js
git commit -m "feat: migrate sources from file-based to PostgreSQL with auto-seed"
```

---

### Task 6: Signals Persistence + Signals API

Store classified radar items in the database and add a new `/api/signals` endpoint with rich filtering.

**Files:**
- Modify: `src/routes/radar.js` — persist classified items after classification
- Create: `src/routes/signals.js` — new filtered/paginated endpoint
- Modify: `server.js` — mount signals route

**Step 1: Update `src/routes/radar.js` to persist signals**

After `classifyRadarItems()` returns, batch-insert new signals. Use the unique index on `link` to skip duplicates:

```javascript
const signalsModel = require('../models/signals');

// After classification:
const newSignals = classified
  .filter(item => item.link)
  .map(item => ({
    title: item.title,
    link: item.link,
    pub_date: item.pubDate || null,
    snippet: item.snippet,
    quadrant: item.quadrant,
    relevance: item.relevance,
    label: item.label,
    source_name: item._sourceName || item.source,
    source_type: item._sourceType,
    source_key: item._sourceKey,
  }));

const inserted = await signalsModel.createBatch(newSignals);
if (inserted.length > 0) {
  console.log(`[radar] Stored ${inserted.length} new signals`);
}
```

**Step 2: Create `src/routes/signals.js`**

```javascript
const { Router } = require('express');
const signalsModel = require('../models/signals');

const router = Router();

router.get('/signals', async (req, res) => {
  try {
    const result = await signalsModel.query({
      quadrant: req.query.quadrant,
      source_key: req.query.source_key,
      source_type: req.query.source_type,
      min_relevance: req.query.min_relevance ? parseInt(req.query.min_relevance, 10) : undefined,
      max_relevance: req.query.max_relevance ? parseInt(req.query.max_relevance, 10) : undefined,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      search: req.query.search,
      sort_by: req.query.sort_by || 'date',
      sort_dir: req.query.sort_dir || 'desc',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[signals]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = { router };
```

**Step 3: Mount in `server.js`**

```javascript
app.use('/api', require('./src/routes/signals').router);
```

**Step 4: Verify**

```bash
# Trigger radar scan to populate signals
curl http://localhost:3000/api/radar | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d[\"items\"])} items classified')"

# Query signals
curl "http://localhost:3000/api/signals?limit=5" | python3 -m json.tool | head -30
curl "http://localhost:3000/api/signals?quadrant=competitors&min_relevance=5" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"total\"]} matching signals')"
```

**Step 5: Commit**

```bash
git add src/routes/radar.js src/routes/signals.js server.js
git commit -m "feat: persist classified signals to DB and add /api/signals with rich filtering"
```

---

### Task 7: Briefing Persistence

Store AI-generated briefings in PostgreSQL instead of the filesystem.

**Files:**
- Modify: `src/routes/briefings.js` — use `briefingsModel` for storage/retrieval

**Step 1: Update briefing routes**

Replace filesystem-based `saveBrief()`, `loadBriefs()`, `getRecentBriefSummaries()` with model calls.

For GET `/api/briefs`:
```javascript
const briefingsModel = require('../models/briefings');

router.get('/briefs', async (req, res) => {
  const briefs = await briefingsModel.getAll();
  res.json({
    ok: true,
    briefs: briefs.map(b => ({
      id: b.id,
      timestamp: b.created_at,
      usage: { in: b.input_tokens, out: b.output_tokens }
    }))
  });
});
```

For GET `/api/briefs/:id`:
```javascript
router.get('/briefs/:id', async (req, res) => {
  const brief = await briefingsModel.getById(req.params.id);
  if (!brief) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({
    ok: true,
    id: brief.id,
    timestamp: brief.created_at,
    text: brief.content,
    usage: { in: brief.input_tokens, out: brief.output_tokens }
  });
});
```

For GET `/api/brief` (streaming generation): After collecting the full streamed response, save to DB:
```javascript
// At end of stream, after collecting fullText:
await briefingsModel.create({
  content: fullText,
  model: 'claude-sonnet-4-5-20250514',
  input_tokens: inputTokens,
  output_tokens: outputTokens,
});
```

For the brief context (recent summaries used in generation prompt):
```javascript
const recent = await briefingsModel.getRecent(3);
const previousContext = recent.map(b => b.content.slice(0, 800)).join('\n---\n');
```

**Step 2: Verify**

```bash
# Generate a brief (requires API key)
curl http://localhost:3000/api/brief

# List briefs
curl http://localhost:3000/api/briefs | python3 -m json.tool
```

**Step 3: Commit**

```bash
git add src/routes/briefings.js
git commit -m "feat: persist briefings to PostgreSQL instead of filesystem"
```

---

### Task 8: Web Monitor Service

Add the ability to monitor arbitrary web pages for changes using `cheerio` and Claude AI.

**Files:**
- Create: `src/services/webMonitorService.js`
- Modify: `src/routes/sources.js` — add POST `/api/sources/add-web-monitor`

**Step 1: Create `src/services/webMonitorService.js`**

```javascript
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const webSnapshotsModel = require('../models/webSnapshots');
const signalsModel = require('../models/signals');

const anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'SnigelRadar/1.0' },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside, [role="navigation"]').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text.slice(0, 10000);
}

function hashContent(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function summarizeChanges(oldText, newText, url) {
  if (!anthropic) return 'Content changed (no AI key for summary)';

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 500,
      system: 'You are a competitive intelligence analyst for Snigel Design AB (Swedish tactical gear). Summarize what changed on this monitored web page concisely. Focus on business-relevant changes.',
      messages: [{
        role: 'user',
        content: `URL: ${url}\n\nPrevious content (excerpt):\n${oldText.slice(0, 3000)}\n\nNew content (excerpt):\n${newText.slice(0, 3000)}\n\nWhat changed? Provide a 1-2 sentence summary.`
      }],
    });
    return resp.content[0].text.trim();
  } catch (e) {
    console.error(`[webmonitor] AI summary error: ${e.message}`);
    return 'Content changed (AI summary failed)';
  }
}

async function checkSource(source) {
  console.log(`[webmonitor] Checking ${source.url}...`);

  const html = await fetchPage(source.url);
  const text = extractText(html);
  const hash = hashContent(text);

  const lastSnapshot = await webSnapshotsModel.getLatest(source.id);

  if (lastSnapshot && lastSnapshot.content_hash === hash) {
    console.log(`[webmonitor] No change: ${source.url}`);
    return null;
  }

  let diffSummary;
  if (lastSnapshot) {
    diffSummary = await summarizeChanges(lastSnapshot.extracted_text, text, source.url);
    console.log(`[webmonitor] Change detected: ${source.url}`);
  } else {
    diffSummary = 'Initial snapshot captured';
    console.log(`[webmonitor] Initial snapshot: ${source.url}`);
  }

  await webSnapshotsModel.create({
    source_id: source.id,
    content_hash: hash,
    extracted_text: text,
    diff_summary: diffSummary,
  });

  // Create signal for actual changes (not initial snapshots)
  if (lastSnapshot) {
    let quadrant = 'anomalies';
    if (source.competitor_key) quadrant = 'competitors';
    else if (source.category === 'industry') quadrant = 'industry';

    await signalsModel.create({
      source_id: source.id,
      title: `Web change: ${source.name || source.url}`,
      link: source.url,
      pub_date: new Date().toISOString(),
      snippet: diffSummary,
      quadrant,
      relevance: 5,
      label: diffSummary.slice(0, 60),
      source_name: source.name || source.url,
      source_type: 'web_monitor',
      source_key: source.competitor_key,
    });
  }

  return diffSummary;
}

module.exports = { checkSource, fetchPage, extractText, hashContent };
```

**Step 2: Add web monitor endpoint in `src/routes/sources.js`**

```javascript
const webMonitor = require('../services/webMonitorService');

router.post('/sources/add-web-monitor', async (req, res) => {
  try {
    const { url, name, competitor_key, category } = req.body;
    if (!url) return res.status(400).json({ ok: false, error: 'URL required' });

    const source = await sourcesModel.create({
      type: 'web_monitor',
      url,
      name: name || url,
      competitor_key: competitor_key || null,
      category: category || 'industry',
    });

    // Take initial snapshot asynchronously
    webMonitor.checkSource(source).catch(e => {
      console.error(`[sources] Initial snapshot failed for ${url}: ${e.message}`);
    });

    res.json({ ok: true, source });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

**Step 3: Verify**

```bash
curl -X POST http://localhost:3000/api/sources/add-web-monitor \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://www.snigel.se", "name": "Snigel Website", "competitor_key": "snigel"}'
```

Expected: returns `{ ok: true, source: { id: ..., type: 'web_monitor', ... } }`

**Step 4: Commit**

```bash
git add src/services/webMonitorService.js src/routes/sources.js
git commit -m "feat: add web page monitoring with cheerio + AI-powered change detection"
```

---

### Task 9: Background Polling Service

Add `node-cron` scheduled jobs that automatically poll RSS feeds and web monitors.

**Files:**
- Create: `src/services/pollingService.js`
- Modify: `server.js` — start polling after server is ready

**Step 1: Create `src/services/pollingService.js`**

```javascript
const cron = require('node-cron');
const sourcesModel = require('../models/sources');
const signalsModel = require('../models/signals');
const scanRunsModel = require('../models/scanRuns');
const feedService = require('./feedService');
const classificationService = require('./classificationService');
const webMonitorService = require('./webMonitorService');

let job = null;

async function pollFeeds(loadSources) {
  const start = Date.now();
  console.log('[poll] Starting feed poll...');

  try {
    const sources = await loadSources();
    feedService.invalidateCache();

    const [compFeeds, indFeeds] = await Promise.all([
      feedService.fetchCompetitorFeeds(sources),
      feedService.fetchIndustryFeeds(sources),
    ]);

    const allItems = [];
    for (const [, items] of Object.entries(compFeeds)) {
      allItems.push(...items);
    }
    allItems.push(...indFeeds);

    const classified = await classificationService.classifyRadarItems(allItems);

    const newSignals = classified
      .filter(item => item.link)
      .map(item => ({
        title: item.title,
        link: item.link,
        pub_date: item.pubDate || null,
        snippet: item.snippet,
        quadrant: item.quadrant,
        relevance: item.relevance,
        label: item.label,
        source_name: item._sourceName || item.source,
        source_type: item._sourceType,
        source_key: item._sourceKey,
      }));

    const inserted = await signalsModel.createBatch(newSignals);

    const duration = Date.now() - start;
    await scanRunsModel.create({
      run_type: 'rss_poll',
      items_found: allItems.length,
      items_classified: inserted.length,
      duration_ms: duration,
    });

    console.log(`[poll] Feed poll complete: ${allItems.length} items, ${inserted.length} new (${duration}ms)`);
  } catch (e) {
    console.error('[poll] Feed poll error:', e.message);
    await scanRunsModel.create({ run_type: 'rss_poll', errors: e.message, duration_ms: Date.now() - start }).catch(() => {});
  }
}

async function pollWebMonitors() {
  const start = Date.now();
  console.log('[poll] Starting web monitor poll...');

  try {
    const monitors = await sourcesModel.getByType('web_monitor');
    let changesFound = 0;

    for (const source of monitors) {
      try {
        const result = await webMonitorService.checkSource(source);
        if (result && result !== 'Initial snapshot captured') changesFound++;
        await sourcesModel.markPolled(source.id);
      } catch (e) {
        console.error(`[poll] Web monitor error for ${source.url}: ${e.message}`);
      }
    }

    const duration = Date.now() - start;
    await scanRunsModel.create({
      run_type: 'web_monitor',
      items_found: monitors.length,
      items_classified: changesFound,
      duration_ms: duration,
    });

    console.log(`[poll] Web monitor complete: ${monitors.length} pages, ${changesFound} changes (${duration}ms)`);
  } catch (e) {
    console.error('[poll] Web monitor error:', e.message);
  }
}

function start(loadSources) {
  job = cron.schedule('*/30 * * * *', () => {
    pollFeeds(loadSources);
    pollWebMonitors();
  });

  console.log('[poll] Background polling started (every 30 min)');

  // Initial poll after 10s delay
  setTimeout(() => {
    pollFeeds(loadSources);
    pollWebMonitors();
  }, 10000);
}

function stop() {
  if (job) { job.stop(); job = null; }
}

module.exports = { start, stop, pollFeeds, pollWebMonitors };
```

**Step 2: Start polling in `server.js`**

After `app.listen`:

```javascript
const pollingService = require('./src/services/pollingService');
pollingService.start(app.locals.loadSources);
```

**Step 3: Verify**

```bash
node server.js
# Wait 10 seconds, should see:
# [poll] Starting feed poll...
# [poll] Feed poll complete: N items, N new (Nms)
# [poll] Starting web monitor poll...
# [poll] Web monitor complete: N pages, N changes (Nms)
```

**Step 4: Commit**

```bash
git add src/services/pollingService.js server.js
git commit -m "feat: add background polling with node-cron for feeds and web monitors"
```

---

### Task 10: Frontend — Signals List Page

Add a new view to the frontend with a filterable, paginated list of all signals. Uses the existing safe DOM helpers `createEl()` and `esc()` from the codebase — no raw innerHTML with user data.

**Files:**
- Modify: `public/index.html` — add signalsView HTML, CSS, JS

**Step 1: Add i18n keys**

In the TRANSLATIONS object, add to both `en` (~line 773) and `sv` (~line 941):

```javascript
// EN additions
signalsPage: 'SIGNALS',
signalsTitle: 'All Signals',
signalsSub: 'Filtered intelligence feed',
filterQuadrant: 'Quadrant',
filterCompetitor: 'Competitor',
filterSourceType: 'Source Type',
filterRelevance: 'Min Relevance',
filterSearch: 'Search...',
filterApply: 'Apply',
filterClear: 'Clear',
signalsOf: 'of',
signalsShowing: 'Showing',
signalsPrev: 'Previous',
signalsNext: 'Next',
allQuadrants: 'All Quadrants',
allCompetitors: 'All Competitors',
allSourceTypes: 'All Types',
rssType: 'RSS Feed',
webMonitorType: 'Web Monitor',
noSignalsFound: 'No signals found',

// SV additions
signalsPage: 'SIGNALER',
signalsTitle: 'Alla signaler',
signalsSub: 'Filtrerat underrättelseflöde',
filterQuadrant: 'Kvadrant',
filterCompetitor: 'Konkurrent',
filterSourceType: 'Källtyp',
filterRelevance: 'Min relevans',
filterSearch: 'Sök...',
filterApply: 'Tillämpa',
filterClear: 'Rensa',
signalsOf: 'av',
signalsShowing: 'Visar',
signalsPrev: 'Föregående',
signalsNext: 'Nästa',
allQuadrants: 'Alla kvadranter',
allCompetitors: 'Alla konkurrenter',
allSourceTypes: 'Alla typer',
rssType: 'RSS-flöde',
webMonitorType: 'Webbövervakning',
noSignalsFound: 'Inga signaler hittades',
```

**Step 2: Add CSS for signals view**

Add after the existing radar CSS block:

```css
#signalsView {
  padding: 1rem 2rem;
  max-width: 1400px;
  margin: 0 auto;
}
.signals-header { margin-bottom: 1.5rem; }
.signals-header h2 { font-size: 1.5rem; color: var(--accent-green); }
.signals-header p { color: var(--text-dim); font-size: 0.85rem; }

.signals-filters {
  display: flex; flex-wrap: wrap; gap: 0.75rem;
  padding: 1rem; background: var(--bg-panel);
  border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 1rem; align-items: flex-end;
}
.signals-filters label {
  display: flex; flex-direction: column; gap: 0.25rem;
  font-size: 0.75rem; color: var(--text-dim);
}
.signals-filters select, .signals-filters input {
  background: var(--bg-card); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 0.4rem 0.5rem; font-size: 0.8rem;
}
.signals-filters button {
  padding: 0.4rem 1rem; border-radius: 4px; cursor: pointer;
  font-size: 0.8rem; border: 1px solid var(--border);
}
.signals-filters .btn-apply {
  background: var(--accent-green); color: #000;
  border: none; font-weight: 600;
}
.signals-filters .btn-clear {
  background: transparent; color: var(--text-dim);
}

.signals-list { display: flex; flex-direction: column; gap: 0.5rem; }

.signal-card {
  display: grid; grid-template-columns: 60px 1fr auto;
  gap: 1rem; padding: 0.75rem 1rem;
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: 6px; align-items: center;
  transition: border-color 0.2s;
}
.signal-card:hover { border-color: var(--accent-green); }

.signal-relevance {
  text-align: center; font-size: 1.4rem; font-weight: 700;
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid;
}
.signal-body a { color: var(--text-primary); text-decoration: none; }
.signal-body a:hover { color: var(--accent-green); }
.signal-meta { font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem; }
.signal-label { font-size: 0.8rem; color: var(--accent-amber); margin-top: 0.15rem; }
.signal-quadrant {
  font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.2rem 0.5rem; border-radius: 3px; white-space: nowrap;
}

.signals-pagination {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1rem 0; font-size: 0.85rem; color: var(--text-dim);
}
.signals-pagination button {
  padding: 0.4rem 1rem; background: var(--bg-card);
  border: 1px solid var(--border); color: var(--text-primary);
  border-radius: 4px; cursor: pointer;
}
.signals-pagination button:disabled { opacity: 0.3; cursor: not-allowed; }
```

**Step 3: Add HTML for signals view**

Between `<div id="radarView">` and `<div id="dashboardView">`, add:

```html
<div id="signalsView" class="hidden">
  <div class="signals-header">
    <h2 data-t="signalsTitle">All Signals</h2>
    <p data-t="signalsSub">Filtered intelligence feed</p>
  </div>
  <div class="signals-filters">
    <label><span data-t="filterQuadrant">Quadrant</span>
      <select id="sigFilterQuadrant">
        <option value="" data-t="allQuadrants">All Quadrants</option>
        <option value="competitors">Competitors</option>
        <option value="industry">Industry</option>
        <option value="snigel">Snigel</option>
        <option value="anomalies">Anomalies</option>
      </select>
    </label>
    <label><span data-t="filterCompetitor">Competitor</span>
      <select id="sigFilterCompetitor">
        <option value="" data-t="allCompetitors">All Competitors</option>
      </select>
    </label>
    <label><span data-t="filterSourceType">Source Type</span>
      <select id="sigFilterSourceType">
        <option value="" data-t="allSourceTypes">All Types</option>
        <option value="rss" data-t="rssType">RSS Feed</option>
        <option value="web_monitor" data-t="webMonitorType">Web Monitor</option>
      </select>
    </label>
    <label><span data-t="filterRelevance">Min Relevance</span>
      <input type="number" id="sigFilterRelevance" min="1" max="10" value="" placeholder="1-10">
    </label>
    <label><span data-t="filterSearch">Search</span>
      <input type="text" id="sigFilterSearch" placeholder="keyword...">
    </label>
    <button class="btn-apply" onclick="loadSignals()" data-t="filterApply">Apply</button>
    <button class="btn-clear" onclick="clearSignalFilters()" data-t="filterClear">Clear</button>
  </div>
  <div class="signals-list" id="signalsList"></div>
  <div class="signals-pagination" id="signalsPagination"></div>
</div>
```

**Step 4: Add JavaScript — use safe DOM methods**

Use the existing `createEl(tag, attrs, children)` and `esc()` helpers from the codebase. No raw innerHTML with user-provided data.

```javascript
let signalsOffset = 0;
const SIGNALS_LIMIT = 50;
const QUAD_COLORS = {
  competitors: '#ef4444',
  industry: '#38bdf8',
  snigel: '#00e5a0',
  anomalies: '#f0a500'
};

async function loadSignals(offset = 0) {
  signalsOffset = offset;
  const params = new URLSearchParams();
  const q = document.getElementById('sigFilterQuadrant').value;
  const c = document.getElementById('sigFilterCompetitor').value;
  const st = document.getElementById('sigFilterSourceType').value;
  const r = document.getElementById('sigFilterRelevance').value;
  const s = document.getElementById('sigFilterSearch').value;

  if (q) params.set('quadrant', q);
  if (c) params.set('source_key', c);
  if (st) params.set('source_type', st);
  if (r) params.set('min_relevance', r);
  if (s) params.set('search', s);
  params.set('limit', SIGNALS_LIMIT);
  params.set('offset', offset);

  const list = document.getElementById('signalsList');
  try {
    const resp = await fetch('/api/signals?' + params.toString());
    const data = await resp.json();
    renderSignalsList(data);
  } catch (e) {
    list.textContent = '';
    list.appendChild(createEl('p', { style: 'color:var(--accent-red)' }, ['Failed to load signals']));
  }
}

function renderSignalsList(data) {
  const list = document.getElementById('signalsList');
  const pag = document.getElementById('signalsPagination');
  list.textContent = '';
  pag.textContent = '';

  if (!data.items || data.items.length === 0) {
    list.appendChild(createEl('p', {
      style: 'color:var(--text-dim);text-align:center;padding:2rem'
    }, [t('noSignalsFound')]));
    return;
  }

  data.items.forEach(s => {
    const color = QUAD_COLORS[s.quadrant] || '#888';
    const date = s.pub_date ? new Date(s.pub_date).toLocaleDateString() : '';

    const relevanceCircle = createEl('div', {
      class: 'signal-relevance',
      style: `color:${color};border-color:${color}`
    }, [String(s.relevance)]);

    const link = createEl('a', {
      href: s.link || '#',
      target: '_blank',
      rel: 'noopener'
    }, [s.title || 'Untitled']);

    const labelDiv = createEl('div', { class: 'signal-label' }, [s.label || '']);
    const metaDiv = createEl('div', { class: 'signal-meta' }, [
      (s.source_name || '') + ' · ' + date
    ]);

    const body = createEl('div', { class: 'signal-body' }, [link, labelDiv, metaDiv]);

    const badge = createEl('span', {
      class: 'signal-quadrant',
      style: `background:${color}22;color:${color}`
    }, [s.quadrant]);

    const card = createEl('div', { class: 'signal-card' }, [relevanceCircle, body, badge]);
    list.appendChild(card);
  });

  // Pagination
  const start = data.offset + 1;
  const end = Math.min(data.offset + data.items.length, data.total);

  const prevBtn = createEl('button', {}, [t('signalsPrev')]);
  if (data.offset === 0) prevBtn.disabled = true;
  else prevBtn.onclick = () => loadSignals(Math.max(0, data.offset - SIGNALS_LIMIT));

  const info = createEl('span', {}, [
    t('signalsShowing') + ' ' + start + '-' + end + ' ' + t('signalsOf') + ' ' + data.total
  ]);

  const nextBtn = createEl('button', {}, [t('signalsNext')]);
  if (end >= data.total) nextBtn.disabled = true;
  else nextBtn.onclick = () => loadSignals(data.offset + SIGNALS_LIMIT);

  pag.appendChild(prevBtn);
  pag.appendChild(info);
  pag.appendChild(nextBtn);
}

function clearSignalFilters() {
  document.getElementById('sigFilterQuadrant').value = '';
  document.getElementById('sigFilterCompetitor').value = '';
  document.getElementById('sigFilterSourceType').value = '';
  document.getElementById('sigFilterRelevance').value = '';
  document.getElementById('sigFilterSearch').value = '';
  loadSignals(0);
}

function populateCompetitorFilter() {
  const sel = document.getElementById('sigFilterCompetitor');
  if (!sel || sel.options.length > 1) return;
  for (const [key, comp] of Object.entries(COMPETITORS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = comp.name;
    sel.appendChild(opt);
  }
}
```

**Step 5: Verify in browser**

Open http://localhost:3000, navigate to Signals view. Should show paginated list. Apply filters, verify counts change.

**Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add signals list page with rich filtering and pagination"
```

---

### Task 11: Frontend — Navigation Update (3 Views)

Update navigation to support Radar | Signals | Dashboard with header buttons.

**Files:**
- Modify: `public/index.html` — update header buttons, switchView function

**Step 1: Update header buttons**

Replace the single `viewModeBtn` with three navigation buttons. Find the existing button (around line 528) and replace with:

```html
<div class="nav-buttons">
  <button id="navRadar" class="nav-btn active" onclick="switchView('radar')">RADAR</button>
  <button id="navSignals" class="nav-btn" onclick="switchView('signals')" data-t="signalsPage">SIGNALS</button>
  <button id="navDashboard" class="nav-btn" onclick="switchView('dashboard')" data-t="dashboard">DASHBOARD</button>
</div>
```

**Step 2: Add CSS for nav buttons**

```css
.nav-buttons { display: flex; gap: 0.25rem; }
.nav-btn {
  padding: 0.4rem 0.8rem; font-size: 0.7rem; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  background: transparent; color: var(--text-dim);
  border: 1px solid var(--border); border-radius: 4px;
  cursor: pointer; transition: all 0.2s;
}
.nav-btn:hover { color: var(--text-primary); border-color: var(--accent-green); }
.nav-btn.active {
  background: var(--accent-green); color: #000;
  border-color: var(--accent-green);
}
```

**Step 3: Update `switchView()` function**

Replace the existing 2-view `switchView()` (around line 1904) with:

```javascript
function switchView(view) {
  currentView = view;
  document.getElementById('radarView').classList.toggle('hidden', view !== 'radar');
  document.getElementById('signalsView').classList.toggle('hidden', view !== 'signals');
  document.getElementById('dashboardView').classList.toggle('hidden', view !== 'dashboard');

  document.getElementById('navRadar').classList.toggle('active', view === 'radar');
  document.getElementById('navSignals').classList.toggle('active', view === 'signals');
  document.getElementById('navDashboard').classList.toggle('active', view === 'dashboard');

  if (view === 'radar') initRadar();
  if (view === 'signals') { populateCompetitorFilter(); loadSignals(0); }
  if (view === 'dashboard') { renderCompetitorCards(); renderSpider(); renderTimeline(); }
}
```

**Step 4: Remove old `viewModeBtn` and its click handler**

Delete the old toggle button element and its click event listener.

**Step 5: Verify in browser**

Navigate between all 3 views. Each should show/hide correctly. Active button styling should follow.

**Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: update navigation to 3 views — Radar, Signals, Dashboard"
```

---

### Task 12: Frontend — Sources Revamp (Web Monitor Support)

Add the ability to enter arbitrary web page URLs for monitoring in the sources modal.

**Files:**
- Modify: `public/index.html` — add web monitor section to sources modal

**Step 1: Add i18n keys**

Add to both `en` and `sv` in TRANSLATIONS:

```javascript
// EN
webMonitors: 'Web Monitors',
addWebMonitor: 'Add Web Monitor',
webMonitorUrl: 'Page URL to monitor',
webMonitorName: 'Display name',
webMonitorAdd: 'Start Monitoring',
webMonitorCategory: 'Category',
webMonitorLastCheck: 'Last checked',
webMonitorNever: 'Never',
webMonitorChecking: 'Taking initial snapshot...',

// SV
webMonitors: 'Webbövervakare',
addWebMonitor: 'Lägg till webbövervakare',
webMonitorUrl: 'Sidans URL att övervaka',
webMonitorName: 'Visningsnamn',
webMonitorAdd: 'Starta övervakning',
webMonitorCategory: 'Kategori',
webMonitorLastCheck: 'Senast kontrollerad',
webMonitorNever: 'Aldrig',
webMonitorChecking: 'Tar första ögonblicksbild...',
```

**Step 2: Add web monitor section to `renderSources()`**

In the `renderSources()` function (around line 2133), after the industry feeds section, add a "Web Monitors" section using safe DOM methods:

```javascript
// Web Monitors section
const webSection = createEl('div', { class: 'source-section' });
webSection.appendChild(createEl('h3', {}, [t('webMonitors')]));

// List existing web monitors
const monitorList = createEl('div', { id: 'webMonitorsList' });
webSection.appendChild(monitorList);

// Add form
const form = createEl('div', { class: 'add-monitor-form', style: 'display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap' });
const urlInput = createEl('input', {
  type: 'text', id: 'monitorUrl',
  placeholder: t('webMonitorUrl'),
  class: 'source-input',
  style: 'flex:2;min-width:200px'
});
const nameInput = createEl('input', {
  type: 'text', id: 'monitorName',
  placeholder: t('webMonitorName'),
  class: 'source-input',
  style: 'flex:1;min-width:120px'
});
const addBtn = createEl('button', { class: 'source-btn' }, [t('webMonitorAdd')]);
addBtn.onclick = addWebMonitor;

form.appendChild(urlInput);
form.appendChild(nameInput);
form.appendChild(addBtn);
webSection.appendChild(form);
```

**Step 3: Load and display existing web monitors**

Modify `openSources()` to also fetch web monitors from the API and display them:

```javascript
// Fetch web monitors separately
async function loadWebMonitors() {
  try {
    const resp = await fetch('/api/sources');
    const data = await resp.json();
    // Filter for web_monitor type (need to add this to the sources API response)
    // For now, show from a dedicated endpoint or filter client-side
  } catch (e) {
    console.error('Failed to load web monitors', e);
  }
}
```

**Step 4: Add `addWebMonitor()` function**

```javascript
async function addWebMonitor() {
  const url = document.getElementById('monitorUrl').value.trim();
  const name = document.getElementById('monitorName').value.trim();
  if (!url) return;

  setSourcesStatus(t('webMonitorChecking'));
  try {
    const resp = await fetch('/api/sources/add-web-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name: name || url, category: 'industry' }),
    });
    const data = await resp.json();
    if (data.ok) {
      document.getElementById('monitorUrl').value = '';
      document.getElementById('monitorName').value = '';
      setSourcesStatus(t('added'));
      openSources();
    } else {
      setSourcesStatus(data.error || 'Error');
    }
  } catch (e) {
    setSourcesStatus('Error: ' + e.message);
  }
}
```

**Step 5: Update GET `/api/sources` to include web monitors**

In `src/routes/sources.js`, update the GET handler to also return web monitors:

```javascript
router.get('/sources', async (req, res) => {
  const legacy = await getLegacySourcesFormat();
  const webMonitors = await sourcesModel.getByType('web_monitor');
  res.json({
    ...legacy,
    web_monitors: webMonitors.map(m => ({
      id: m.id, url: m.url, name: m.name,
      category: m.category, competitor_key: m.competitor_key,
      last_polled_at: m.last_polled_at,
    })),
  });
});
```

**Step 6: Verify in browser**

Open Sources modal. See the Web Monitors section. Add a URL. Verify it appears.

**Step 7: Commit**

```bash
git add public/index.html src/routes/sources.js
git commit -m "feat: add web monitor support to sources modal"
```

---

### Task 13: Railway Deployment Configuration

Prepare the project for Railway deployment with PostgreSQL.

**Files:**
- Create: `Procfile`
- Create: `railway.json`
- Modify: `package.json` — add engines
- Modify: `.gitignore` — ensure secrets excluded

**Step 1: Create `Procfile`**

```
web: node server.js
```

**Step 2: Create `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

**Step 3: Update `package.json`**

Add `engines` field:

```json
"engines": {
  "node": ">=18.0.0"
}
```

**Step 4: Update `.gitignore`**

Ensure no secrets or generated data get pushed:

```
node_modules/
.env
data/briefs/
data/profiles.json
```

Keep `data/sources.json` in git — it's used for initial DB seeding.

**Step 5: Verify server starts cleanly**

```bash
node server.js
```

Should start without errors, run migrations, seed if needed, start polling.

**Step 6: Commit**

```bash
git add Procfile railway.json package.json .gitignore
git commit -m "feat: add Railway deployment configuration"
```

**Step 7: Deploy to Railway (manual)**

```bash
railway login
railway init
railway add --plugin postgresql
railway variables set ANTHROPIC_API_KEY=<your-key>
railway up
```

After deployment:
- PostgreSQL `DATABASE_URL` is auto-injected by the Railway plugin
- Migrations run automatically on startup
- Background polling starts after 10s

---

## Task Summary

| # | Task | Key Output |
|---|------|-----------|
| 1 | DB foundation | `src/config.js`, `src/db/*`, `001_initial.sql` |
| 2 | Models layer | `src/models/*.js` (6 files) |
| 3 | Extract services | `src/services/feedService.js`, `classificationService.js` |
| 4 | Extract routes | `src/routes/*.js` (6 files), slim `server.js` |
| 5 | Sources → DB | `src/services/seedService.js`, `src/helpers/legacyFormat.js` |
| 6 | Signals API | `src/routes/signals.js`, radar persistence |
| 7 | Briefing persistence | `src/routes/briefings.js` update |
| 8 | Web monitor | `src/services/webMonitorService.js` |
| 9 | Background polling | `src/services/pollingService.js` |
| 10 | Signals page (FE) | `public/index.html` — signals view |
| 11 | Navigation (FE) | `public/index.html` — 3-view nav |
| 12 | Sources revamp (FE) | `public/index.html` — web monitor UI |
| 13 | Railway deploy | `Procfile`, `railway.json` |
