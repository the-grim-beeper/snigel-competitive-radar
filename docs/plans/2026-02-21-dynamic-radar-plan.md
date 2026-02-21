# Dynamic News Radar — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static competitor-position radar with a dynamic news radar that displays AI-classified RSS news items in 4 quadrants: Competitors, Industry Events, Snigel Direct, and General/Anomalies.

**Architecture:** Single-pass AI classification on feed fetch. All feed items are collected, chunked (~40 per batch), sent to Claude for quadrant + relevance classification, then cached and served to the frontend via a new `/api/radar` endpoint. The frontend redraws the radar canvas with 4 quadrants and news blips instead of static competitor dots.

**Tech Stack:** Node.js/Express backend, Canvas 2D frontend, Anthropic Claude API (Sonnet) for classification.

---

### Task 1: Add radar cache slot and classification function to server.js

**Files:**
- Modify: `server.js:246-253` (cache object + isCacheValid)
- Modify: `server.js:63-67` (constants area, add CHUNK_SIZE)

**Step 1: Add radar cache slot and chunk size constant**

In `server.js`, add `radar` to the cache object at line 246 and a chunk-size constant near line 67:

```javascript
// Near line 67, after PROFILES_FILE:
const RADAR_CHUNK_SIZE = 40;

// At line 246, expand the cache object:
const cache = {
  competitors: { data: null, timestamp: 0 },
  industry: { data: null, timestamp: 0 },
  radar: { data: null, timestamp: 0 },
};
```

**Step 2: Add the `classifyRadarItems` function**

Insert after the `fetchIndustryFeeds` function (after line 337), before the Express routes:

```javascript
// --- Radar classification ---
async function classifyRadarItems(allItems) {
  // Fallback if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return allItems.map((item, i) => ({
      ...item,
      quadrant: item._sourceType === 'competitor' ? 'competitors' : 'industry',
      relevance: 0.5,
      label: (item.title || '').substring(0, 40),
    }));
  }

  // Chunk items
  const chunks = [];
  for (let i = 0; i < allItems.length; i += RADAR_CHUNK_SIZE) {
    chunks.push(allItems.slice(i, i + RADAR_CHUNK_SIZE));
  }

  const anthropic = new Anthropic();
  const classifiedItems = [];

  // Process chunks in parallel
  const chunkResults = await Promise.all(chunks.map(async (chunk, chunkIdx) => {
    const itemsForPrompt = chunk.map((item, i) => ({
      index: i,
      title: item.title,
      snippet: (item.snippet || '').substring(0, 150),
      source: item.source || '',
      sourceType: item._sourceType || 'unknown',
    }));

    try {
      const response = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 2048,
        system: `You are a competitive intelligence classifier for Snigel Design AB (Swedish tactical gear manufacturer). Classify news items into exactly one of four quadrants and score their relevance.

Quadrants:
- "competitors": News about specific competitor companies (NFM, Mehler, Lindnerhof, Savotta, Sacci, Taiga, Tasmanian Tiger, UF PRO, Equipnor, PTD, or any tactical gear competitor)
- "industry": Defense industry events, procurement, trade shows, regulation, military modernization programs
- "snigel": News directly mentioning or relevant to Snigel Design AB
- "anomalies": Unusual signals, cross-cutting trends, or items that don't fit the above but could be strategically important

Relevance scoring (0.0 to 1.0):
- 1.0 = directly actionable for Snigel leadership (competitor M&A, lost/won contract, direct mention)
- 0.7-0.9 = highly relevant (competitor product launch, major procurement, industry shift)
- 0.4-0.6 = moderately relevant (general defense news, tangential industry event)
- 0.1-0.3 = low relevance (peripheral news, weak connection)

Return ONLY a raw JSON array, no markdown fences. Each element:
{"index": 0, "quadrant": "competitors", "relevance": 0.75, "label": "Short 3-6 word label"}`,
        messages: [{
          role: 'user',
          content: `Classify these ${chunk.length} news items:\n\n${JSON.stringify(itemsForPrompt, null, 1)}`,
        }],
      });

      const text = response.content[0].text.trim();
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      return { chunkIdx, classifications: JSON.parse(cleaned) };
    } catch (err) {
      console.error(`[RADAR] Classification error (chunk ${chunkIdx}):`, err.message);
      // Fallback for failed chunk
      return {
        chunkIdx,
        classifications: chunk.map((item, i) => ({
          index: i,
          quadrant: item._sourceType === 'competitor' ? 'competitors' : 'industry',
          relevance: 0.5,
          label: (item.title || '').substring(0, 40),
        })),
      };
    }
  }));

  // Merge results back in order
  chunkResults.sort((a, b) => a.chunkIdx - b.chunkIdx);
  chunkResults.forEach(({ chunkIdx, classifications }) => {
    const chunk = chunks[chunkIdx];
    classifications.forEach((cl) => {
      const item = chunk[cl.index];
      if (!item) return;
      classifiedItems.push({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: item.source,
        quadrant: cl.quadrant,
        relevance: Math.max(0, Math.min(1, cl.relevance || 0.5)),
        label: cl.label || (item.title || '').substring(0, 40),
      });
    });
  });

  return classifiedItems;
}
```

**Step 3: Run server to verify no syntax errors**

Run: `cd /Users/nicklaslundblad/projects/snigel-competitive-radar && node -c server.js`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add radar classification function with chunked AI processing"
```

---

### Task 2: Add /api/radar endpoint and cache invalidation

**Files:**
- Modify: `server.js` (after the `/api/feeds/all` route at ~line 386, add new endpoint)
- Modify: `server.js` (all places that invalidate caches — also invalidate `cache.radar`)

**Step 1: Add the /api/radar endpoint**

Insert after the `/api/status` route (after line 407):

```javascript
// --- Radar Items API ---
app.get('/api/radar', async (req, res) => {
  try {
    if (isCacheValid('radar')) {
      return res.json({ ok: true, timestamp: cache.radar.timestamp, items: cache.radar.data });
    }

    const [competitors, industry] = await Promise.all([
      fetchCompetitorFeeds(),
      fetchIndustryFeeds(),
    ]);

    // Flatten all items with source metadata
    const allItems = [];

    Object.entries(competitors).forEach(([key, data]) => {
      if (!data.items) return;
      data.items.forEach(item => {
        allItems.push({ ...item, _sourceType: 'competitor', _sourceKey: key, _sourceName: data.name });
      });
    });

    industry.forEach(item => {
      allItems.push({ ...item, _sourceType: 'industry' });
    });

    console.log(`[RADAR] Classifying ${allItems.length} items...`);
    const classified = await classifyRadarItems(allItems);

    cache.radar = { data: classified, timestamp: Date.now() };
    console.log(`[RADAR] Classification complete. ${classified.length} items on radar.`);

    res.json({ ok: true, timestamp: cache.radar.timestamp, items: classified });
  } catch (err) {
    console.error('[RADAR] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Step 2: Add radar cache invalidation everywhere feeds are invalidated**

Search for all occurrences of `cache.competitors = { data: null` and `cache.industry = { data: null` in source management routes and add `cache.radar = { data: null, timestamp: 0 };` alongside them. There are 5 locations:

- `PUT /api/sources` (~line 422-423)
- `POST /api/sources/add-competitor` (~line 436)
- `DELETE /api/sources/competitor/:key` (~line 448)
- `POST /api/sources/add-industry` (~line 461)
- `DELETE /api/sources/industry` (~line 470)

At each location, add after the existing invalidation lines:
```javascript
cache.radar = { data: null, timestamp: 0 };
```

**Step 3: Verify syntax**

Run: `node -c server.js`
Expected: No output

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add /api/radar endpoint with cache invalidation"
```

---

### Task 3: Add i18n keys for radar quadrants

**Files:**
- Modify: `public/index.html` (TRANSLATIONS objects at ~line 586 for `en` and ~line 748 for `sv`)

**Step 1: Add English translation keys**

In the `en` translations object, replace the radar sector keys (lines 638-646) with:

```javascript
    // Radar quadrants
    radarQuadCompetitors: 'COMPETITORS',
    radarQuadIndustry: 'INDUSTRY',
    radarQuadSnigel: 'SNIGEL',
    radarQuadAnomalies: 'ANOMALIES',
    // Radar
    newsRadar: 'News Radar',
    radarSubNews: 'Proximity = relevance to Snigel',
    radarLoading: 'Classifying signals...',
    radarNoItems: 'No radar items yet. Click SCAN NOW.',
    radarItemsCount: 'items on radar',
```

Keep the old keys (`carry`, `ballistic`, etc.) — they are unused after the canvas rewrite but removing them risks breaking anything that still references them. They can be cleaned up later.

**Step 2: Add Swedish translation keys**

In the `sv` translations object, add the corresponding keys:

```javascript
    radarQuadCompetitors: 'KONKURRENTER',
    radarQuadIndustry: 'BRANSCH',
    radarQuadSnigel: 'SNIGEL',
    radarQuadAnomalies: 'ANOMALIER',
    newsRadar: 'Nyhetsradar',
    radarSubNews: 'Närhet = relevans för Snigel',
    radarLoading: 'Klassificerar signaler...',
    radarNoItems: 'Inga radarobjekt ännu. Klicka SKANNA NU.',
    radarItemsCount: 'objekt på radarn',
```

**Step 3: Update panel header text in the `applyLanguage` function**

Find the line (~932) that sets the radar panel title:
```javascript
if (panels[0]) { panels[0].querySelector('.panel-title').lastChild.textContent = t('threatRadar'); panels[0].querySelector('.panel-count').textContent = t('radarSub'); }
```

Change to:
```javascript
if (panels[0]) { panels[0].querySelector('.panel-title').lastChild.textContent = t('newsRadar'); panels[0].querySelector('.panel-count').textContent = t('radarSubNews'); }
```

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add i18n keys for news radar quadrants"
```

---

### Task 4: Rewrite radar canvas — initRadar and animateRadar

**Files:**
- Modify: `public/index.html` (lines 1029-1196 — radar state variables and both radar functions)

**Step 1: Add radar items state variable**

Near line 1029, replace:
```javascript
let radarAnimFrame = null;
let radarAngle = 0;
```

With:
```javascript
let radarAnimFrame = null;
let radarAngle = 0;
let radarItems = [];
let radarHoveredItem = null;
```

**Step 2: Replace `initRadar` function (lines 1103-1119)**

```javascript
function initRadar() {
  const canvas = document.getElementById('radarCanvas');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  // Build legend for 4 quadrants
  const legend = document.getElementById('radarLegend');
  legend.replaceChildren();
  const quadrants = [
    { key: 'competitors', color: '#ef4444', label: t('radarQuadCompetitors') },
    { key: 'industry', color: '#38bdf8', label: t('radarQuadIndustry') },
    { key: 'snigel', color: '#00e5a0', label: t('radarQuadSnigel') },
    { key: 'anomalies', color: '#f0a500', label: t('radarQuadAnomalies') },
  ];
  quadrants.forEach(q => {
    const dot = createEl('div', { className: 'legend-dot', style: { background: q.color } });
    const item = createEl('div', { className: 'legend-item' }, [dot, q.label]);
    legend.appendChild(item);
  });

  // Assign angular positions to radar items within their quadrant
  const quadrantRanges = {
    competitors: [315, 45],   // top-right (crossing 0)
    industry:   [45, 135],    // bottom-right
    snigel:     [135, 225],   // bottom-left
    anomalies:  [225, 315],   // top-left
  };

  const byQuadrant = { competitors: [], industry: [], snigel: [], anomalies: [] };
  radarItems.forEach(item => {
    const q = byQuadrant[item.quadrant] || byQuadrant.anomalies;
    q.push(item);
  });

  Object.entries(byQuadrant).forEach(([qKey, items]) => {
    const [startDeg, endDeg] = quadrantRanges[qKey];
    const range = startDeg < endDeg ? endDeg - startDeg : (360 - startDeg + endDeg);
    items.forEach((item, i) => {
      const fraction = items.length === 1 ? 0.5 : (i + 0.5) / items.length;
      const angleDeg = startDeg + fraction * range;
      item._angleDeg = angleDeg % 360;
      // Distance: high relevance = close to center (0.15-0.85 range of maxR)
      item._dist = 0.15 + (1 - item.relevance) * 0.7;
    });
  });

  animateRadar();
}
```

**Step 3: Replace `animateRadar` function (lines 1121-1196)**

```javascript
function animateRadar() {
  const canvas = document.getElementById('radarCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(cx, cy) * 0.88;
  const dpr = window.devicePixelRatio || 1;
  radarAngle += 0.008;
  ctx.clearRect(0, 0, w, h);

  // Concentric rings
  for (let i = 1; i <= 4; i++) {
    const r = maxR * (i / 4);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = i === 4 ? '#1a2740' : '#0f1a2e'; ctx.lineWidth = dpr; ctx.stroke();
  }

  // 4 quadrant dividing lines (cross)
  for (let a = 0; a < 4; a++) {
    const angle = ((a * 90 + 45 - 90) * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
    ctx.strokeStyle = '#1a2740'; ctx.lineWidth = dpr; ctx.stroke();
  }

  // Quadrant labels
  const quadLabels = [
    { label: t('radarQuadCompetitors'), deg: 0, color: '#ef4444' },
    { label: t('radarQuadIndustry'), deg: 90, color: '#38bdf8' },
    { label: t('radarQuadSnigel'), deg: 180, color: '#00e5a0' },
    { label: t('radarQuadAnomalies'), deg: 270, color: '#f0a500' },
  ];
  ctx.font = `${10 * dpr}px 'Share Tech Mono', monospace`;
  quadLabels.forEach(ql => {
    const a = ((ql.deg - 90) * Math.PI) / 180;
    ctx.fillStyle = ql.color + '88';
    ctx.textAlign = 'center';
    ctx.fillText(ql.label, cx + Math.cos(a) * (maxR * 0.55), cy + Math.sin(a) * (maxR * 0.55) + 3 * dpr);
  });

  // Sweep line
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(radarAngle);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, maxR, -0.4, 0); ctx.closePath();
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, maxR);
  sg.addColorStop(0, '#00e5a000'); sg.addColorStop(0.3, '#00e5a015'); sg.addColorStop(1, '#00e5a008');
  ctx.fillStyle = sg; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(maxR, 0);
  ctx.strokeStyle = '#00e5a066'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
  ctx.restore();

  // Ring labels
  ctx.font = `${8 * dpr}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = '#243554'; ctx.textAlign = 'left';
  ['HIGH', 'MED', 'LOW', ''].forEach((label, i) => {
    if (!label) return;
    ctx.fillText(label, cx + 6 * dpr, cy - maxR * ((i + 1) / 4) + 12 * dpr);
  });

  // Quadrant colors for blips
  const quadColors = { competitors: '#ef4444', industry: '#38bdf8', snigel: '#00e5a0', anomalies: '#f0a500' };

  // Draw news blips
  radarItems.forEach((item) => {
    if (item._angleDeg === undefined) return;
    const angle = ((item._angleDeg - 90) * Math.PI) / 180;
    const dist = item._dist * maxR;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const color = quadColors[item.quadrant] || '#f0a500';

    // Sweep glow effect
    const blipAngle = Math.atan2(by - cy, bx - cx);
    let sd = radarAngle - blipAngle;
    while (sd > Math.PI) sd -= Math.PI * 2;
    while (sd < -Math.PI) sd += Math.PI * 2;
    const near = Math.abs(sd) < 0.5;
    const fade = near ? 1 - Math.abs(sd) / 0.5 : 0;
    if (near) {
      const gr = (12 + fade * 8) * dpr;
      const glow = ctx.createRadialGradient(bx, by, 0, bx, by, gr);
      glow.addColorStop(0, color + '66'); glow.addColorStop(1, color + '00');
      ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
    }

    // Blip dot — size varies by relevance
    const bs = (3 + item.relevance * 3) * dpr;
    ctx.beginPath(); ctx.arc(bx, by, bs, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(bx, by, bs + 2 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = color + '44'; ctx.lineWidth = dpr; ctx.stroke();

    // Label
    ctx.font = `${8 * dpr}px 'Rajdhani', sans-serif`;
    ctx.fillStyle = color + 'cc'; ctx.textAlign = 'center';
    const labelText = (item.label || '').substring(0, 20);
    ctx.fillText(labelText, bx, by + bs * 1.5 + 10 * dpr);

    // Store pixel position for hit-testing
    item._bx = bx / dpr; item._by = by / dpr; item._bs = bs / dpr;
  });

  // Center dot — Snigel
  ctx.beginPath(); ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#00e5a0'; ctx.fill();
  ctx.font = `bold ${10 * dpr}px 'Oxanium', sans-serif`;
  ctx.fillStyle = '#00e5a0'; ctx.textAlign = 'center';
  ctx.fillText('SNIGEL', cx, cy + 16 * dpr);

  // Hover tooltip
  if (radarHoveredItem) {
    const hi = radarHoveredItem;
    const tx = hi._bx * dpr, ty = (hi._by - 20) * dpr;
    const tooltipText = hi.title || hi.label;
    ctx.font = `${10 * dpr}px 'Rajdhani', sans-serif`;
    const tw = ctx.measureText(tooltipText).width + 16 * dpr;
    const th = 22 * dpr;
    const ttx = Math.max(4 * dpr, Math.min(tx - tw / 2, w - tw - 4 * dpr));
    const tty = Math.max(4 * dpr, ty - th);
    ctx.fillStyle = '#0d1528ee';
    ctx.strokeStyle = (quadColors[hi.quadrant] || '#f0a500') + '88';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.roundRect(ttx, tty, tw, th, 3 * dpr);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.fillText(tooltipText, ttx + 8 * dpr, tty + 15 * dpr);
  }

  radarAnimFrame = requestAnimationFrame(animateRadar);
}
```

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: rewrite radar canvas for 4-quadrant news blips"
```

---

### Task 5: Add mouse interaction (hover + click) to radar canvas

**Files:**
- Modify: `public/index.html` (insert after `initRadar` function, before the `animateRadar` call site)

**Step 1: Add event listeners for canvas hover and click**

Insert right after the `animateRadar` function closing brace (after the function, not inside it):

```javascript
// --- Radar mouse interaction ---
(function setupRadarMouse() {
  const canvas = document.getElementById('radarCanvas');

  function getHitItem(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let closest = null, closestDist = Infinity;
    radarItems.forEach(item => {
      if (item._bx === undefined) return;
      const dx = mx - item._bx, dy = my - item._by;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < (item._bs + 6) && d < closestDist) {
        closest = item; closestDist = d;
      }
    });
    return closest;
  }

  canvas.addEventListener('mousemove', (e) => {
    const hit = getHitItem(e);
    radarHoveredItem = hit;
    canvas.style.cursor = hit ? 'pointer' : 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    radarHoveredItem = null;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('click', (e) => {
    const hit = getHitItem(e);
    if (hit && hit.link) {
      window.open(hit.link, '_blank', 'noopener');
    }
  });
})();
```

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add hover tooltip and click-to-open for radar blips"
```

---

### Task 6: Wire up frontend to fetch /api/radar and populate radar

**Files:**
- Modify: `public/index.html` (find the startup/init code that calls `initRadar()` and loads feed data)

**Step 1: Add fetchRadarItems function and call it on load**

Find the main initialization code (where feeds are loaded and `initRadar()` is first called, around line 1071). Add a function to fetch radar data and hook it into the startup flow:

```javascript
async function fetchRadarItems() {
  try {
    const res = await fetch('/api/radar');
    const data = await res.json();
    if (data.ok && data.items) {
      radarItems = data.items;
      // Update panel subtitle with count
      const panels = document.querySelectorAll('.panel');
      if (panels[0]) {
        panels[0].querySelector('.panel-count').textContent =
          `${radarItems.length} ${t('radarItemsCount')}`;
      }
    }
  } catch (err) {
    console.error('[RADAR] Fetch error:', err.message);
  }
  cancelAnimationFrame(radarAnimFrame);
  initRadar();
}
```

Then in the startup flow, replace the direct `initRadar()` call with `fetchRadarItems()`. Also hook it into the "SCAN NOW" button handler — after feeds are refreshed, re-fetch radar items too.

Find the scan button handler (search for `scanBtn`) and add `fetchRadarItems()` after the feed refresh calls.

**Step 2: Update the applyLanguage function**

Ensure the `applyLanguage` function (around line 927) calls `fetchRadarItems()` instead of just `initRadar()` so the legend labels update correctly:

Replace:
```javascript
cancelAnimationFrame(radarAnimFrame);
initRadar();
```
With:
```javascript
cancelAnimationFrame(radarAnimFrame);
fetchRadarItems();
```

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: wire frontend to /api/radar endpoint and populate radar on load"
```

---

### Task 7: Add radar tooltip CSS and update HTML panel header

**Files:**
- Modify: `public/index.html` (CSS section for radar tooltip, and the HTML at line 443-444)

**Step 1: Update the static HTML panel header**

At line 443-444, change the default text (it gets overwritten by JS, but good for initial render):

```html
<div class="panel-title"><div class="icon"></div>News Radar</div>
<div class="panel-count">Classifying signals...</div>
```

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: update radar panel header for news radar"
```

---

### Task 8: Integration test — run server and verify end-to-end

**Step 1: Install dependencies and start server**

Run:
```bash
cd /Users/nicklaslundblad/projects/snigel-competitive-radar && npm install
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY node server.js
```

**Step 2: Test the /api/radar endpoint**

In a separate terminal:
```bash
curl -s http://localhost:3000/api/radar | node -e "
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const d = JSON.parse(Buffer.concat(chunks));
    console.log('OK:', d.ok);
    console.log('Items:', d.items?.length);
    if (d.items?.length) {
      const q = {};
      d.items.forEach(i => q[i.quadrant] = (q[i.quadrant]||0) + 1);
      console.log('Quadrants:', q);
      console.log('Sample:', JSON.stringify(d.items[0], null, 2));
    }
  });
"
```

Expected: `OK: true`, items array with quadrant/relevance/label fields.

**Step 3: Open browser and verify radar visually**

Open `http://localhost:3000` in a browser. Verify:
- Radar shows 4 quadrants with labels (COMPETITORS, INDUSTRY, SNIGEL, ANOMALIES)
- Blips appear as colored dots in their respective quadrants
- Hovering a blip shows the full headline tooltip
- Clicking a blip opens the article link
- Sweep animation still works with glow on blips

**Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: integration fixes for dynamic news radar"
```
