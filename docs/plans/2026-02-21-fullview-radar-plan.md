# Full-View Radar with Relevance Filtering — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make radar the full-viewport default landing page with 1-10 integer relevance scale and adjustable threshold slider.

**Architecture:** Two CSS-toggled view containers (`#radarView` and `#dashboardView`) replace the current `<main class="main">` grid. Header gains a DASHBOARD/RADAR toggle button. Backend Claude prompt changes from 0.0-1.0 to 1-10 integer relevance. Frontend filters items below slider threshold before rendering.

**Tech Stack:** Vanilla JS, CSS, HTML canvas, Express/Node backend

---

### Task 1: Backend — Change relevance to 1-10 integer scale

**Files:**
- Modify: `server.js:379-394` (Claude system prompt)
- Modify: `server.js:432` (relevance clamping)
- Modify: `server.js:351` (fallback relevance)
- Modify: `server.js:412` (chunk-error fallback relevance)

**Step 1: Update the Claude system prompt**

In `server.js`, find the system prompt at line 379-394. Replace the relevance section:

```
OLD (lines 387-394):
Relevance scoring (0.0 to 1.0):
- 1.0 = directly actionable for Snigel leadership (competitor M&A, lost/won contract, direct mention)
- 0.7-0.9 = highly relevant (competitor product launch, major procurement, industry shift)
- 0.4-0.6 = moderately relevant (general defense news, tangential industry event)
- 0.1-0.3 = low relevance (peripheral news, weak connection)

Return ONLY a raw JSON array, no markdown fences. Each element:
{"index": 0, "quadrant": "competitors", "relevance": 0.75, "label": "Short 3-6 word label"}

NEW:
Relevance scoring (integer 1-10):
- 10 = directly actionable for Snigel leadership (competitor M&A, lost/won contract, direct mention)
- 7-9 = highly relevant (competitor product launch, major procurement, industry shift)
- 4-6 = moderately relevant (general defense news, tangential industry event)
- 1-3 = low relevance (peripheral news, weak connection)

Return ONLY a raw JSON array, no markdown fences. Each element:
{"index": 0, "quadrant": "competitors", "relevance": 7, "label": "Short 3-6 word label"}
```

**Step 2: Update relevance clamping**

At line 432, change:
```javascript
// OLD:
relevance: Math.max(0, Math.min(1, cl.relevance || 0.5)),
// NEW:
relevance: Math.max(1, Math.min(10, Math.round(cl.relevance) || 5)),
```

**Step 3: Update fallback relevance values**

At line 351 (no-API-key fallback), change:
```javascript
// OLD:
relevance: 0.5,
// NEW:
relevance: 5,
```

At line 412 (chunk-error fallback), change:
```javascript
// OLD:
relevance: 0.5,
// NEW:
relevance: 5,
```

**Step 4: Test manually**

Run: `cd /Users/nicklaslundblad/projects/snigel-competitive-radar && node -e "require('./server.js')" &`
Then: `curl -s http://localhost:3000/api/radar | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.items.slice(0,3).map(i=>({r:i.relevance,q:i.quadrant})))})"`
Expected: relevance values are integers 1-10 (or 5 in fallback mode)

Kill the test server afterward.

**Step 5: Commit**

```bash
git add server.js
git commit -m "feat: change radar relevance from 0-1 float to 1-10 integer scale"
```

---

### Task 2: Frontend — Add i18n keys for new UI elements

**Files:**
- Modify: `public/index.html:595-654` (EN translations)
- Modify: `public/index.html:760-817` (SV translations)

**Step 1: Add new i18n keys to EN translations**

After the `radarItemsCount` line (654), add:

```javascript
    radarThreshold: 'Min Relevance',
    dashboard: 'DASHBOARD',
    radar: 'RADAR',
    radarFilteredCount: 'showing',
    radarOfTotal: 'of',
```

**Step 2: Add new i18n keys to SV translations**

After the `radarItemsCount` line (817), add:

```javascript
    radarThreshold: 'Min relevans',
    dashboard: 'INSTRUMENTPANEL',
    radar: 'RADAR',
    radarFilteredCount: 'visar',
    radarOfTotal: 'av',
```

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add i18n keys for radar/dashboard view toggle and threshold slider"
```

---

### Task 3: Frontend — Add CSS for radar-view and dashboard-view containers

**Files:**
- Modify: `public/index.html:91-97` (radar-panel CSS)
- Modify: `public/index.html` (add new CSS rules after existing radar styles)

**Step 1: Add full-view radar CSS**

After the `.legend-dot` rule (line 97), add these new CSS rules:

```css
/* Full-view radar */
#radarView {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 60px);
  background: var(--bg-deepest);
}
#radarView.hidden { display: none; }
#dashboardView.hidden { display: none; }

.radar-fullview {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 1rem 2rem;
  gap: 2rem;
}
.radar-fullview-canvas {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.radar-fullview-canvas canvas {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
}
.radar-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  padding-top: 1rem;
}
.radar-sidebar .panel-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.threshold-control {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.threshold-label {
  font-family: var(--font-data);
  font-size: 0.75rem;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
}
.threshold-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--border-bright);
  border-radius: 2px;
  outline: none;
}
.threshold-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-green);
  cursor: pointer;
  box-shadow: 0 0 8px var(--accent-green-dim);
}
.threshold-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-green);
  cursor: pointer;
  border: none;
  box-shadow: 0 0 8px var(--accent-green-dim);
}
.radar-item-count {
  font-family: var(--font-data);
  font-size: 0.7rem;
  color: var(--text-dim);
}
```

**Step 2: Update mobile responsive rule**

At line 294-300, update the media query to include radar fullview collapse:

```css
@media (max-width: 1100px) {
  .main { grid-template-columns: 1fr; }
  .radar-panel, .feed-panel, .competitors-panel, .spider-panel, .timeline-panel { grid-column: 1; }
  .competitors-panel, .spider-panel, .timeline-panel { grid-row: auto; }
  .radar-container { width: 340px; height: 340px; }
  .radar-fullview { flex-direction: column; padding: 1rem; }
  .radar-sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; gap: 1rem; }
}
```

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add CSS for full-view radar and dashboard view containers"
```

---

### Task 4: Frontend — Restructure HTML for two views

**Files:**
- Modify: `public/index.html:439-448` (HTML structure)

**Step 1: Wrap existing `<main>` in a dashboard container and add radar view**

Replace lines 439-448 (the `<main>` opening through the radar panel closing tag) with:

```html
<!-- ═══ RADAR VIEW (default, full viewport) ═══ -->
<div id="radarView">
  <div class="radar-fullview">
    <div class="radar-fullview-canvas">
      <canvas id="radarCanvasFull"></canvas>
    </div>
    <div class="radar-sidebar">
      <div class="panel-title"><div class="icon"></div><span id="radarViewTitle">News Radar</span></div>
      <div class="threshold-control">
        <div class="threshold-label">
          <span id="thresholdLabel">Min Relevance</span>
          <span id="thresholdValue">4</span>
        </div>
        <input type="range" class="threshold-slider" id="thresholdSlider" min="1" max="10" value="4" step="1">
      </div>
      <div class="radar-item-count" id="radarViewCount"></div>
      <div class="radar-legend" id="radarFullLegend"></div>
    </div>
  </div>
</div>

<!-- ═══ DASHBOARD VIEW (secondary) ═══ -->
<div id="dashboardView" class="hidden">
<main class="main">
  <section class="panel radar-panel">
    <div class="panel-header">
      <div class="panel-title"><div class="icon"></div>News Radar</div>
      <div class="panel-count">Classifying signals...</div>
    </div>
    <div class="radar-container"><canvas id="radarCanvas"></canvas></div>
    <div class="radar-legend" id="radarLegend"></div>
  </section>
```

Then, at the end of the `</main>` tag (find the closing `</main>` after all panels), add the closing `</div>` for `#dashboardView`.

**Step 2: Add DASHBOARD button to header**

At line 436 (the viewToggle button), replace:
```html
    <button class="btn" id="viewToggle">GRID VIEW</button>
```
with:
```html
    <button class="btn" id="viewToggle">GRID VIEW</button>
    <button class="btn" id="viewModeBtn">DASHBOARD</button>
```

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: restructure HTML with radar-view and dashboard-view containers"
```

---

### Task 5: Frontend — Add view switching JS and threshold logic

**Files:**
- Modify: `public/index.html` (JS section)

**Step 1: Add state variable**

After `let radarHoveredItem = null;` (line 1051), add:

```javascript
let currentView = 'radar'; // 'radar' or 'dashboard'
let radarThreshold = 4;
```

**Step 2: Add view switching function**

After the `toggleView()` function (line 1665), add:

```javascript
function switchView(view) {
  currentView = view;
  const radarView = document.getElementById('radarView');
  const dashboardView = document.getElementById('dashboardView');
  const btn = document.getElementById('viewModeBtn');

  if (view === 'radar') {
    radarView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    btn.textContent = t('dashboard');
    cancelAnimationFrame(radarAnimFrame);
    initRadar();
  } else {
    radarView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    btn.textContent = t('radar');
    cancelAnimationFrame(radarAnimFrame);
    initDashboardRadar();
  }
}
```

**Step 3: Add threshold slider handler**

In the `DOMContentLoaded` handler (after line 1058), add:

```javascript
  document.getElementById('viewModeBtn').addEventListener('click', () => {
    switchView(currentView === 'radar' ? 'dashboard' : 'radar');
  });
  document.getElementById('thresholdSlider').addEventListener('input', (e) => {
    radarThreshold = parseInt(e.target.value, 10);
    document.getElementById('thresholdValue').textContent = radarThreshold;
    cancelAnimationFrame(radarAnimFrame);
    initRadar();
  });
```

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add view switching logic and threshold slider handler"
```

---

### Task 6: Frontend — Update initRadar to use full-view canvas and threshold filtering

**Files:**
- Modify: `public/index.html:1143-1193` (initRadar function)

**Step 1: Rewrite initRadar**

Replace the `initRadar` function (lines 1143-1193) with:

```javascript
function initRadar() {
  // Determine which canvas/legend to use based on current view
  const isFull = currentView === 'radar';
  const canvas = document.getElementById(isFull ? 'radarCanvasFull' : 'radarCanvas');
  if (!canvas) return;
  const legendId = isFull ? 'radarFullLegend' : 'radarLegend';

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const size = isFull ? Math.min(rect.width, rect.height) : Math.min(rect.width, rect.height);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';

  // Build legend for 4 quadrants
  const legend = document.getElementById(legendId);
  if (legend) {
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
  }

  // Filter items by threshold
  const filtered = radarItems.filter(item => item.relevance >= radarThreshold);

  // Update count display
  if (isFull) {
    const countEl = document.getElementById('radarViewCount');
    if (countEl) countEl.textContent = `${t('radarFilteredCount')} ${filtered.length} ${t('radarOfTotal')} ${radarItems.length} ${t('radarItemsCount')}`;
    const titleEl = document.getElementById('radarViewTitle');
    if (titleEl) titleEl.textContent = t('newsRadar');
    const threshLabel = document.getElementById('thresholdLabel');
    if (threshLabel) threshLabel.textContent = t('radarThreshold');
  }

  // Assign angular positions to filtered items within their quadrant
  const quadrantRanges = {
    competitors: [315, 45],
    industry:   [45, 135],
    snigel:     [135, 225],
    anomalies:  [225, 315],
  };

  const byQuadrant = { competitors: [], industry: [], snigel: [], anomalies: [] };
  filtered.forEach(item => {
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
      item._dist = 0.15 + (1 - item.relevance / 10) * 0.7;
    });
  });

  // Store filtered items for animateRadar to use
  radarFilteredItems = filtered;
  animateRadar();
}

// Small dashboard radar (unchanged logic, uses radarCanvas)
function initDashboardRadar() {
  const prevView = currentView;
  currentView = 'dashboard';
  initRadar();
  currentView = prevView;
}
```

**Step 2: Add `radarFilteredItems` state variable**

After `let radarThreshold = 4;`, add:

```javascript
let radarFilteredItems = [];
```

**Step 3: Update animateRadar to use filtered items**

In `animateRadar()` (line 1257), change `radarItems.forEach((item) => {` to `radarFilteredItems.forEach((item) => {`.

Also update the blip relevance-based size calculation (line 1280):
```javascript
// OLD:
const bs = (3 + item.relevance * 3) * dpr;
// NEW:
const bs = (3 + (item.relevance / 10) * 4) * dpr;
```

**Step 4: Update the mouse hit-testing**

In the `setupRadarMouse` IIFE (around line 1335), change `radarItems.forEach(item => {` to `radarFilteredItems.forEach(item => {`.

**Step 5: Update the distance formula in animateRadar**

The old `item._dist` was computed as `0.15 + (1 - item.relevance) * 0.7` where relevance was 0-1. The new formula in initRadar already computes `item._dist = 0.15 + (1 - item.relevance / 10) * 0.7`, so `animateRadar` just reads `item._dist` — no change needed there.

**Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: update initRadar for full-view canvas with threshold filtering"
```

---

### Task 7: Frontend — Update fetchRadarItems and panel count for new scale

**Files:**
- Modify: `public/index.html:1121-1138` (fetchRadarItems function)

**Step 1: Update fetchRadarItems panel count for dashboard view**

In `fetchRadarItems()`, update the panel count display (lines 1127-1131):

```javascript
async function fetchRadarItems() {
  try {
    const res = await fetch('/api/radar');
    const data = await res.json();
    if (data.ok && data.items) {
      radarItems = data.items;
      // Update dashboard panel count
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

This is essentially unchanged — the function already works correctly. The key difference is that `initRadar()` now handles threshold filtering internally.

**Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: wire fetchRadarItems to threshold-aware initRadar"
```

---

### Task 8: Frontend — Update language switch and resize handlers

**Files:**
- Modify: `public/index.html` (language switch function, resize handler)

**Step 1: Update language switch**

In the language switch function (around line 940-958), update the radar view title:

After line 947 (`fetchRadarItems();`), add:
```javascript
  // Update radar fullview labels
  const titleEl = document.getElementById('radarViewTitle');
  if (titleEl) titleEl.textContent = t('newsRadar');
  const threshLabel = document.getElementById('thresholdLabel');
  if (threshLabel) threshLabel.textContent = t('radarThreshold');
  const viewBtn = document.getElementById('viewModeBtn');
  if (viewBtn) viewBtn.textContent = currentView === 'radar' ? t('dashboard') : t('radar');
```

**Step 2: Update resize handler**

At line 2752, ensure resize triggers correct radar:
```javascript
// OLD:
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { cancelAnimationFrame(radarAnimFrame); initRadar(); renderSpider(); }, 250); });
```
This already calls `initRadar()` which now adapts to current view, so no change needed.

**Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: update language switch for radar fullview labels"
```

---

### Task 9: Integration test — verify both views work

**Step 1: Start the server**

```bash
cd /Users/nicklaslundblad/projects/snigel-competitive-radar && node server.js &
```

**Step 2: Verify /api/radar returns integer relevance**

```bash
curl -s http://localhost:3000/api/radar | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);const sample=j.items.slice(0,5);sample.forEach(i=>console.log(i.relevance,typeof i.relevance,i.quadrant))})"
```
Expected: All relevance values are integers 1-10.

**Step 3: Open browser and verify radar full-view**

Navigate to `http://localhost:3000`. Expected:
- Radar fills the viewport (full height minus header)
- Legend and threshold slider visible on the right
- Slider defaults to 4
- Blips render correctly
- DASHBOARD button visible in header

**Step 4: Test view switching**

- Click DASHBOARD — dashboard grid appears, radar button shows RADAR
- Click RADAR — back to full-view radar

**Step 5: Test threshold slider**

- Move slider to 1 — all items visible, count updates
- Move slider to 8 — fewer items, count updates
- Move slider to 10 — only highest relevance items

**Step 6: Kill test server**

```bash
kill %1
```

**Step 7: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration fixes for full-view radar"
```
