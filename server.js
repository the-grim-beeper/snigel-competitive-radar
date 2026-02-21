const express = require('express');
const RSSParser = require('rss-parser');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// --- Password protection (set SITE_PASSWORD env var to enable) ---
const SITE_PASSWORD = process.env.SITE_PASSWORD;
if (SITE_PASSWORD) {
  const crypto = require('crypto');
  const TOKEN = crypto.createHash('sha256').update(SITE_PASSWORD).digest('hex').slice(0, 32);

  app.post('/login', (req, res) => {
    if (req.body.password === SITE_PASSWORD) {
      res.cookie('auth', TOKEN, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
      return res.json({ ok: true });
    }
    res.status(401).json({ ok: false, error: 'Wrong password' });
  });

  app.use((req, res, next) => {
    if (req.path === '/login') return next();
    const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('auth='));
    if (cookie && cookie.split('=')[1] === TOKEN) return next();
    // Serve login page
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNIGEL RADAR — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0e14;color:#c8d6e5;font-family:'Oxanium',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;overflow:hidden}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(0,255,136,.04),transparent 60%),radial-gradient(ellipse at 70% 80%,rgba(0,200,255,.03),transparent 60%);pointer-events:none}
.login-box{background:rgba(15,20,30,.9);border:1px solid rgba(0,255,136,.15);border-radius:2px;padding:3rem;width:340px;text-align:center;position:relative}
.login-box::before{content:'';position:absolute;top:-1px;left:20%;right:20%;height:1px;background:linear-gradient(90deg,transparent,rgba(0,255,136,.6),transparent)}
h1{font-size:.85rem;letter-spacing:4px;color:#00ff88;margin-bottom:.3rem;text-transform:uppercase}
.sub{font-family:'Share Tech Mono',monospace;font-size:.65rem;color:#546e7a;letter-spacing:2px;margin-bottom:2rem}
input{width:100%;padding:.75rem 1rem;background:rgba(0,255,136,.03);border:1px solid rgba(0,255,136,.15);border-radius:2px;color:#e8f0f8;font-family:'Share Tech Mono',monospace;font-size:.85rem;outline:none;transition:border-color .2s}
input:focus{border-color:rgba(0,255,136,.5)}
input::placeholder{color:#3a5060}
button{width:100%;margin-top:1rem;padding:.7rem;background:rgba(0,255,136,.1);border:1px solid rgba(0,255,136,.3);color:#00ff88;font-family:'Oxanium',sans-serif;font-size:.8rem;letter-spacing:3px;text-transform:uppercase;cursor:pointer;border-radius:2px;transition:all .2s}
button:hover{background:rgba(0,255,136,.2);border-color:rgba(0,255,136,.5)}
.err{color:#ff4757;font-size:.75rem;margin-top:.75rem;min-height:1.2em;font-family:'Share Tech Mono',monospace}
</style></head>
<body><div class="login-box"><h1>Snigel Radar</h1><div class="sub">COMPETITIVE INTELLIGENCE</div>
<form id="f"><input type="password" name="password" placeholder="Enter password" autofocus autocomplete="current-password">
<button type="submit">AUTHENTICATE</button><div class="err" id="e"></div></form>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:e.target.password.value})});if(r.ok)location.reload();else document.getElementById('e').textContent='ACCESS DENIED';}</script>
</div></body></html>`);
  });
}

const parser = new RSSParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'SnigelRadar/1.0 (Competitive Intelligence)',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

const PORT = process.env.PORT || 3000;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const SOURCES_FILE = path.join(__dirname, 'data', 'sources.json');
const AI_MODEL = 'claude-sonnet-4-5-20250929';
const BRIEFS_DIR = path.join(__dirname, 'data', 'briefs');
const PROFILES_FILE = path.join(__dirname, 'data', 'profiles.json');
const RADAR_CHUNK_SIZE = 40;

// --- Default feed sources (used if sources.json doesn't exist) ---
const DEFAULT_SOURCES = {
  competitors: {
    snigel: {
      name: 'Snigel Design',
      feeds: [
        'https://news.google.com/rss/search?q=%22Snigel+Design%22+OR+%22SNIGEL%22+tactical&hl=en&gl=SE&ceid=SE:en',
        'https://news.google.com/rss/search?q=%22Snigel+Design%22+OR+%22SnigelDesign%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    nfm: {
      name: 'NFM Group',
      feeds: [
        'https://news.google.com/rss/search?q=%22NFM+Group%22+military+OR+defense+OR+tactical&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22NFM+Group%22+OR+%22nfm.no%22&hl=no&gl=NO&ceid=NO:no',
      ],
    },
    mehler: {
      name: 'Mehler Systems',
      feeds: [
        'https://news.google.com/rss/search?q=%22Mehler+Systems%22+OR+%22Mehler+Protection%22&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Mehler+Systems%22+OR+%22Mehler+Vario%22&hl=de&gl=DE&ceid=DE:de',
      ],
    },
    lindnerhof: {
      name: 'Lindnerhof Taktik',
      feeds: [
        'https://news.google.com/rss/search?q=%22Lindnerhof+Taktik%22+OR+%22Lindnerhof-Taktik%22&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Lindnerhof%22+tactical+OR+military&hl=de&gl=DE&ceid=DE:de',
      ],
    },
    sacci: {
      name: 'Sacci AB',
      feeds: [
        'https://news.google.com/rss/search?q=%22Sacci+AB%22+OR+%22Sacci+Pro%22+military+OR+tactical+OR+medical&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Sacci+AB%22+OR+%22Sacci+Pro%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    savotta: {
      name: 'Savotta',
      feeds: [
        'https://news.google.com/rss/search?q=%22Savotta%22+military+OR+defense+OR+tactical+Finland&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Savotta%22+puolustusvoimat+OR+armeija&hl=fi&gl=FI&ceid=FI:fi',
      ],
    },
    taiga: {
      name: 'Taiga AB',
      feeds: [
        'https://news.google.com/rss/search?q=%22Taiga%22+tactical+clothing+military+Sweden&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Taiga+AB%22+OR+%22taiga.se%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    tasmanian_tiger: {
      name: 'Tasmanian Tiger',
      feeds: [
        'https://news.google.com/rss/search?q=%22Tasmanian+Tiger%22+tactical+OR+military+OR+gear&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Tasmanian+Tiger%22+Tatonka+tactical&hl=de&gl=DE&ceid=DE:de',
      ],
    },
    equipnor: {
      name: 'Equipnor',
      feeds: [
        'https://news.google.com/rss/search?q=%22Equipnor%22+military+OR+defense&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Equipnor%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    ptd: {
      name: 'PTD Group',
      feeds: [
        'https://news.google.com/rss/search?q=%22Precision+Technic+Defence%22+OR+%22PTD+Group%22&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Precision+Technic+Defence%22&hl=da&gl=DK&ceid=DK:da',
      ],
    },
    ufpro: {
      name: 'UF PRO',
      feeds: [
        'https://news.google.com/rss/search?q=%22UF+PRO%22+tactical+clothing+military&hl=en&ceid=US:en',
      ],
    },
  },
  industry: [
    'https://news.google.com/rss/search?q=european+defense+equipment+tactical+soldier+modernization&hl=en&ceid=US:en',
    'https://news.google.com/rss/search?q=soldier+equipment+Europe+procurement+2025+OR+2026&hl=en&ceid=US:en',
    'https://news.google.com/rss/search?q=europeisk+f%C3%B6rsvar+upphandling+soldatutrustning&hl=sv&gl=SE&ceid=SE:sv',
    'https://news.google.com/rss/search?q=NATO+soldier+modernization+load+carrying&hl=en&ceid=US:en',
    'https://www.reddit.com/r/tacticalgear/.rss',
  ],
};

// --- Source persistence ---
function loadSources() {
  try {
    if (fs.existsSync(SOURCES_FILE)) {
      return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[SOURCES] Error loading sources.json:', err.message);
  }
  // First run or corrupt file — seed from defaults
  saveSources(DEFAULT_SOURCES);
  return DEFAULT_SOURCES;
}

function saveSources(sources) {
  const dir = path.dirname(SOURCES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

let sources = loadSources();

// --- Profile persistence ---
function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[PROFILES] Error loading profiles.json:', err.message);
  }
  return null; // null means "use frontend defaults"
}

function saveProfiles(profiles) {
  const dir = path.dirname(PROFILES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// Convenience accessors (so existing fetch code works unchanged)
function getCompetitorFeeds() { return sources.competitors; }
function getIndustryFeeds() { return sources.industry; }

// --- Brief persistence ---
function ensureBriefsDir() {
  if (!fs.existsSync(BRIEFS_DIR)) fs.mkdirSync(BRIEFS_DIR, { recursive: true });
}

function saveBrief(text, usage) {
  ensureBriefsDir();
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const brief = {
    id,
    timestamp: new Date().toISOString(),
    text,
    usage,
    signalCount: 0,
  };
  fs.writeFileSync(path.join(BRIEFS_DIR, `${id}.json`), JSON.stringify(brief, null, 2));
  console.log(`[BRIEF] Saved as ${id}.json`);
  return brief;
}

function loadBriefs() {
  ensureBriefsDir();
  const files = fs.readdirSync(BRIEFS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(BRIEFS_DIR, f), 'utf8'));
    } catch { return null; }
  }).filter(Boolean);
}

function getRecentBriefSummaries(count = 3) {
  const briefs = loadBriefs().slice(0, count);
  if (briefs.length === 0) return '';
  return briefs.map((b, i) => {
    const date = new Date(b.timestamp).toISOString().split('T')[0];
    // Take first 800 chars of each brief as context
    const excerpt = b.text.substring(0, 800);
    return `--- Previous Brief (${date}) ---\n${excerpt}\n---`;
  }).join('\n\n');
}

// --- Cache ---
const cache = {
  competitors: { data: null, timestamp: 0 },
  industry: { data: null, timestamp: 0 },
  radar: { data: null, timestamp: 0 },
};

function isCacheValid(key) {
  return cache[key].data && Date.now() - cache[key].timestamp < CACHE_TTL;
}

// --- Feed fetching ---
async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || '',
      source: item.creator || item.source || feed.title || '',
      snippet:
        (item.contentSnippet || item.content || '').substring(0, 300) || '',
    }));
  } catch (err) {
    console.error(`Feed error [${url.substring(0, 80)}...]: ${err.message}`);
    return [];
  }
}

async function fetchCompetitorFeeds() {
  if (isCacheValid('competitors')) return cache.competitors.data;

  console.log('[SCAN] Fetching competitor feeds...');
  const results = {};

  const entries = Object.entries(getCompetitorFeeds());
  for (const [key, config] of entries) {
    const allItems = [];
    for (const feedUrl of config.feeds) {
      const items = await fetchFeed(feedUrl);
      allItems.push(...items);
    }

    // Deduplicate by title similarity
    const seen = new Set();
    const unique = allItems.filter((item) => {
      const normalized = item.title.toLowerCase().substring(0, 60);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    // Sort by date, most recent first
    unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    results[key] = {
      name: config.name,
      items: unique.slice(0, 15), // Keep top 15 per competitor
    };
  }

  cache.competitors = { data: results, timestamp: Date.now() };
  console.log(
    `[SCAN] Complete. Found items for ${Object.keys(results).length} competitors.`
  );
  return results;
}

async function fetchIndustryFeeds() {
  if (isCacheValid('industry')) return cache.industry.data;

  console.log('[SCAN] Fetching industry feeds...');
  const allItems = [];

  for (const feedUrl of getIndustryFeeds()) {
    const items = await fetchFeed(feedUrl);
    allItems.push(...items);
  }

  const seen = new Set();
  const unique = allItems.filter((item) => {
    const normalized = item.title.toLowerCase().substring(0, 60);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const result = unique.slice(0, 30);

  cache.industry = { data: result, timestamp: Date.now() };
  console.log(`[SCAN] Industry feed: ${result.length} items.`);
  return result;
}

// --- Radar classification ---
async function classifyRadarItems(allItems) {
  // Fallback if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return allItems.map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: item.source || '',
      quadrant: item._sourceType === 'competitor' ? 'competitors' : 'industry',
      relevance: 5,
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

Relevance scoring (integer 1-10):
- 10 = directly actionable for Snigel leadership (competitor M&A, lost/won contract, direct mention)
- 7-9 = highly relevant (competitor product launch, major procurement, industry shift)
- 4-6 = moderately relevant (general defense news, tangential industry event)
- 1-3 = low relevance (peripheral news, weak connection)

Return ONLY a raw JSON array, no markdown fences. Each element:
{"index": 0, "quadrant": "competitors", "relevance": 7, "label": "Short 3-6 word label"}`,
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
          relevance: 5,
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
        relevance: Math.max(1, Math.min(10, Math.round(cl.relevance) || 5)),
        label: cl.label || (item.title || '').substring(0, 40),
      });
    });
  });

  return classifiedItems;
}

// --- Express routes ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/feeds/competitors', async (req, res) => {
  try {
    const data = await fetchCompetitorFeeds();
    res.json({
      ok: true,
      timestamp: cache.competitors.timestamp,
      data,
    });
  } catch (err) {
    console.error('Competitor feed error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/feeds/industry', async (req, res) => {
  try {
    const data = await fetchIndustryFeeds();
    res.json({
      ok: true,
      timestamp: cache.industry.timestamp,
      data,
    });
  } catch (err) {
    console.error('Industry feed error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/feeds/all', async (req, res) => {
  try {
    const [competitors, industry] = await Promise.all([
      fetchCompetitorFeeds(),
      fetchIndustryFeeds(),
    ]);
    res.json({
      ok: true,
      timestamp: Date.now(),
      competitors,
      industry,
    });
  } catch (err) {
    console.error('All feeds error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    cache: {
      competitors: {
        cached: !!cache.competitors.data,
        age: cache.competitors.timestamp
          ? Date.now() - cache.competitors.timestamp
          : null,
      },
      industry: {
        cached: !!cache.industry.data,
        age: cache.industry.timestamp
          ? Date.now() - cache.industry.timestamp
          : null,
      },
    },
  });
});

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

// --- Source Management API ---
app.get('/api/sources', (req, res) => {
  res.json({ ok: true, sources });
});

app.put('/api/sources', (req, res) => {
  const updated = req.body;
  if (!updated || !updated.competitors || !updated.industry) {
    return res.status(400).json({ ok: false, error: 'Invalid sources format' });
  }
  sources = updated;
  saveSources(sources);
  // Invalidate feed caches so next scan uses new sources
  cache.competitors = { data: null, timestamp: 0 };
  cache.industry = { data: null, timestamp: 0 };
  cache.radar = { data: null, timestamp: 0 };
  console.log('[SOURCES] Updated and saved. Cache invalidated.');
  res.json({ ok: true });
});

app.post('/api/sources/add-competitor', (req, res) => {
  const { key, name, feeds } = req.body;
  if (!key || !name || !Array.isArray(feeds)) {
    return res.status(400).json({ ok: false, error: 'Requires key, name, feeds[]' });
  }
  const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  sources.competitors[safeKey] = { name, feeds };
  saveSources(sources);
  cache.competitors = { data: null, timestamp: 0 };
  cache.radar = { data: null, timestamp: 0 };
  console.log(`[SOURCES] Added competitor: ${name} (${safeKey})`);
  res.json({ ok: true, key: safeKey });
});

app.delete('/api/sources/competitor/:key', (req, res) => {
  const { key } = req.params;
  if (!sources.competitors[key]) {
    return res.status(404).json({ ok: false, error: 'Competitor not found' });
  }
  delete sources.competitors[key];
  saveSources(sources);
  cache.competitors = { data: null, timestamp: 0 };
  cache.radar = { data: null, timestamp: 0 };
  console.log(`[SOURCES] Removed competitor: ${key}`);
  res.json({ ok: true });
});

app.post('/api/sources/add-industry', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Requires url' });
  }
  if (!sources.industry.includes(url)) {
    sources.industry.push(url);
    saveSources(sources);
    cache.industry = { data: null, timestamp: 0 };
    cache.radar = { data: null, timestamp: 0 };
  }
  res.json({ ok: true });
});

app.delete('/api/sources/industry', (req, res) => {
  const { url } = req.body;
  sources.industry = sources.industry.filter((u) => u !== url);
  saveSources(sources);
  cache.industry = { data: null, timestamp: 0 };
  cache.radar = { data: null, timestamp: 0 };
  res.json({ ok: true });
});

// --- AI Source Suggestions ---
app.post('/api/sources/suggest', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'ANTHROPIC_API_KEY not set.',
    });
  }

  try {
    const lang = req.body.lang || 'en';

    const currentCompetitors = Object.entries(sources.competitors)
      .map(([key, c]) => `- ${c.name} (${key}): ${c.feeds.length} feeds`)
      .join('\n');
    const currentIndustry = sources.industry
      .map((u, i) => `- Feed ${i + 1}: ${u}`)
      .join('\n');

    const suggestLanguageInstruction = lang === 'sv' ? '\n\nRespond in Swedish.' : '';

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      system: `You are an OSINT analyst specializing in European defense and tactical equipment industries. You help configure RSS feed sources for competitive intelligence monitoring of Snigel Design AB (Swedish tactical gear manufacturer).

You know MULTIPLE types of RSS sources — suggest a DIVERSE MIX, not just Google News:

1. **Google News RSS** (news aggregation):
   https://news.google.com/rss/search?q=SEARCH_QUERY&hl=LANG&gl=COUNTRY&ceid=COUNTRY:LANG
   URL-encode terms. Use %22 for exact match. Use OR for alternatives.

2. **Industry publication RSS feeds** (direct from source):
   - Defense News: https://www.defensenews.com/arc/outboundfeeds/rss/category/land/
   - Janes: https://www.janes.com/feeds/news
   - Army Recognition: https://www.armyrecognition.com/rss
   - Shephard Media: https://www.shephardmedia.com/rss/news/landwarfareint/
   - European Defence Review: https://www.edrmagazine.eu/feed
   - Defence Industry Europe: https://defenceindustryeurope.eu/feed/
   - Soldat & Teknik: https://www.soldat.nu/feed/
   - Nordic Defence Sector: https://nordicdefencesector.com/feed/
   - Spartanat: https://www.spartanat.com/feed/
   - MILMAG: https://milmag.eu/feed

3. **Company blogs / press releases** (direct competitor monitoring):
   Look for /feed, /rss, /news/feed on competitor websites.

4. **Reddit RSS** (community intelligence):
   https://www.reddit.com/r/SUBREDDIT/.rss
   Relevant subreddits: r/tacticalgear, r/QualityTacticalGear, r/MilitaryProcurement

5. **Government procurement RSS** (contract intelligence):
   - TED (EU tenders): https://ted.europa.eu/api/v3.0/notices/search?q=CPV%3D35800000&fields=rss
   - FMV (Swedish procurement): check for RSS on fmv.se
   - NATO NSPA: check for RSS on nspa.nato.int

6. **YouTube RSS** (product launches, reviews):
   https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID

7. **Trade show / event feeds**: Eurosatory, DSEI, Enforce Tac, AUSA, SHOT Show

IMPORTANT: Prioritize REAL, VERIFIED RSS URLs that you are confident exist. For direct publication feeds, prefer well-known defense media outlets. Only suggest Google News as a fallback when no direct RSS exists for a topic.${suggestLanguageInstruction}`,
      messages: [{
        role: 'user',
        content: `Here are the current sources being monitored:

COMPETITOR FEEDS:
${currentCompetitors}

INDUSTRY FEEDS:
${currentIndustry}

Analyze the current coverage and suggest 5-8 new RSS feed sources that would improve intelligence coverage. Suggest a DIVERSE MIX of source types — NOT just Google News. Prioritize:
1. Direct RSS feeds from defense industry publications (Janes, Defense News, Spartanat, MILMAG, etc.)
2. Competitor company blogs/press release feeds
3. Reddit or community feeds for tactical gear discussions
4. Government procurement feeds (TED/EU tenders, FMV)
5. YouTube channels covering tactical equipment reviews
6. Google News only as fallback for topics with no direct RSS

Return ONLY a JSON array of suggestions, each with this structure:
{
  "type": "competitor" or "industry",
  "key": "snake_case_key (for competitor type only)",
  "name": "Display Name (for competitor type only)",
  "url": "full RSS URL",
  "reason": "Brief explanation of why this source adds value"
}

Return raw JSON array only, no markdown fences or other text.`,
      }],
    });

    const text = response.content[0].text.trim();
    let suggestions;
    try {
      // Strip markdown fences if model includes them despite instructions
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      suggestions = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ ok: false, error: 'AI returned invalid JSON', raw: text });
    }

    res.json({
      ok: true,
      suggestions,
      usage: response.usage,
    });
  } catch (err) {
    console.error('[SUGGEST] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Feed Search / Discovery API ---
app.post('/api/sources/search', async (req, res) => {
  const { query, lang } = req.body;
  if (!query || !query.trim()) return res.status(400).json({ ok: false, error: 'Query required' });

  const q = query.trim();
  const results = [];

  // 1. Always generate Google News RSS options
  const encodedQ = encodeURIComponent(q);
  const exactQ = encodeURIComponent(`"${q}"`);
  results.push({
    url: `https://news.google.com/rss/search?q=${encodedQ}&hl=en&ceid=US:en`,
    title: `Google News (EN): ${q}`,
    type: 'google_news',
  });
  if (lang === 'sv' || lang !== 'en') {
    const hl = lang || 'sv';
    const gl = hl === 'sv' ? 'SE' : hl === 'de' ? 'DE' : hl === 'no' ? 'NO' : hl === 'fi' ? 'FI' : hl.toUpperCase();
    results.push({
      url: `https://news.google.com/rss/search?q=${encodedQ}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`,
      title: `Google News (${hl.toUpperCase()}): ${q}`,
      type: 'google_news',
    });
  }
  // Exact match variant
  results.push({
    url: `https://news.google.com/rss/search?q=${exactQ}&hl=en&ceid=US:en`,
    title: `Google News (exact): "${q}"`,
    type: 'google_news',
  });

  // 2. Reddit search
  results.push({
    url: `https://www.reddit.com/search/.rss?q=${encodedQ}&sort=new`,
    title: `Reddit search: ${q}`,
    type: 'reddit',
  });

  // 3. If query looks like a URL, try to discover RSS feeds
  if (q.match(/^https?:\/\//i) || q.match(/^[\w-]+\.[\w.]+$/)) {
    let baseUrl = q.startsWith('http') ? q : `https://${q}`;
    baseUrl = baseUrl.replace(/\/+$/, '');

    const feedPaths = ['/feed', '/rss', '/feed/rss', '/atom.xml', '/rss.xml', '/index.xml', '/feed.xml', '/blog/feed', '/news/feed'];
    const discovered = [];

    await Promise.allSettled(feedPaths.map(async (p) => {
      try {
        const url = baseUrl + p;
        const feed = await parser.parseURL(url);
        if (feed && feed.items && feed.items.length > 0) {
          discovered.push({
            url,
            title: `${feed.title || baseUrl}${p} (${feed.items.length} items)`,
            type: 'discovered',
            items: feed.items.length,
          });
        }
      } catch {}
    }));

    // Sort by item count descending
    discovered.sort((a, b) => b.items - a.items);
    results.unshift(...discovered);
  }

  res.json({ ok: true, results });
});

// --- Competitor Profile Management API ---
app.get('/api/profiles', (req, res) => {
  const profiles = loadProfiles();
  res.json({ ok: true, profiles }); // null means frontend should use defaults
});

app.put('/api/profiles', (req, res) => {
  const profiles = req.body;
  if (!profiles || !profiles.competitors) {
    return res.status(400).json({ ok: false, error: 'Invalid profiles format' });
  }
  saveProfiles(profiles);
  console.log('[PROFILES] Saved all profiles.');
  res.json({ ok: true });
});

app.put('/api/profiles/:key', (req, res) => {
  const { key } = req.params;
  const profileData = req.body;
  if (!profileData || !profileData.name) {
    return res.status(400).json({ ok: false, error: 'Invalid profile data' });
  }
  let profiles = loadProfiles();
  if (!profiles) {
    return res.status(400).json({ ok: false, error: 'No profiles saved yet. Save full profiles first.' });
  }
  profiles.competitors[key] = profileData;
  saveProfiles(profiles);
  console.log(`[PROFILES] Updated: ${profileData.name} (${key})`);
  res.json({ ok: true });
});

app.post('/api/profiles', (req, res) => {
  const { key, profile } = req.body;
  if (!key || !profile || !profile.name) {
    return res.status(400).json({ ok: false, error: 'Requires key and profile with name' });
  }
  let profiles = loadProfiles();
  if (!profiles) {
    return res.status(400).json({ ok: false, error: 'No profiles saved yet. Save full profiles first.' });
  }
  const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (profiles.competitors[safeKey]) {
    return res.status(409).json({ ok: false, error: 'Competitor key already exists' });
  }
  profiles.competitors[safeKey] = profile;
  saveProfiles(profiles);
  console.log(`[PROFILES] Added: ${profile.name} (${safeKey})`);
  res.json({ ok: true, key: safeKey });
});

app.delete('/api/profiles/:key', (req, res) => {
  const { key } = req.params;
  let profiles = loadProfiles();
  if (!profiles || !profiles.competitors[key]) {
    return res.status(404).json({ ok: false, error: 'Profile not found' });
  }
  const name = profiles.competitors[key].name;
  delete profiles.competitors[key];
  saveProfiles(profiles);
  console.log(`[PROFILES] Deleted: ${name} (${key})`);
  res.json({ ok: true });
});

// --- AI Competitor Scanner ---
app.post('/api/profiles/scan', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY not set.' });
  }

  try {
    const lang = req.body.lang || 'en';
    const profiles = loadProfiles();
    const currentList = profiles
      ? Object.entries(profiles.competitors).map(([k, c]) => `- ${c.name} (${c.country}, ${c.revenue}): ${c.focus?.join(', ')}`).join('\n')
      : 'No profiles saved yet.';

    const langInstr = lang === 'sv' ? '\n\nRespond entirely in Swedish.' : '';

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: `You are a competitive intelligence analyst specializing in the European military and tactical equipment industry. You help identify competitors for Snigel Design AB, a Swedish manufacturer of modular tactical carry systems, ballistic protection, and tactical clothing.${langInstr}`,
      messages: [{
        role: 'user',
        content: `Here are the competitors currently tracked:

${currentList}

Identify 3-5 additional competitors that Snigel should monitor. Focus on:
1. European tactical gear manufacturers (carry systems, plate carriers, pouches, tactical clothing)
2. Companies competing in military procurement tenders against Snigel
3. Companies with overlapping product portfolios in the Nordic/European defense market

For each competitor, provide a complete profile as JSON. Return ONLY a JSON array with this structure for each:
{
  "key": "snake_case_key",
  "name": "Company Name",
  "country": "Country",
  "flag": "XX",
  "founded": 2000,
  "revenue": "estimated revenue string",
  "employees": "employee count string",
  "hq": "City, Country",
  "threat": "high|medium|low",
  "color": "#hexcolor",
  "focus": ["Product Category 1", "Product Category 2", "Product Category 3"],
  "channels": "Distribution description",
  "radarAngle": 180,
  "radarDist": 0.5,
  "capabilities": {"breadth": 5, "scale": 5, "certs": 5, "price": 5, "reach": 5, "innovation": 5},
  "swot": {"s": "Strengths text", "w": "Weaknesses text", "o": "Opportunities text", "t": "Threats text"},
  "timeline": [{"date": "2020", "text": "Event description"}],
  "reason": "Why Snigel should monitor this competitor"
}

radarAngle should be 0-360 (position on the radar), radarDist should be 0.2-0.8 (0=center=highest threat, 1=edge=lowest). capabilities scores are 1-10. Choose colors that are visually distinct from existing competitors. Return raw JSON array only, no markdown fences.`
      }],
    });

    const text = response.content[0].text.trim();
    let suggestions;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      suggestions = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ ok: false, error: 'AI returned invalid JSON', raw: text });
    }

    res.json({ ok: true, suggestions, usage: response.usage });
  } catch (err) {
    console.error('[SCAN-COMPETITORS] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- AI Brief (Claude Sonnet 4.5 via Anthropic SDK) ---
app.get('/api/brief', async (req, res) => {
  // Require API key via env var
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'ANTHROPIC_API_KEY not set. Start server with: ANTHROPIC_API_KEY=sk-... npm start',
    });
  }

  try {
    const [competitors, industry] = await Promise.all([
      fetchCompetitorFeeds(),
      fetchIndustryFeeds(),
    ]);

    // Build signal digest for the prompt
    const signalLines = [];
    Object.entries(competitors).forEach(([key, data]) => {
      if (!data.items?.length) return;
      data.items.slice(0, 5).forEach((item) => {
        const date = item.pubDate
          ? new Date(item.pubDate).toISOString().split('T')[0]
          : 'unknown';
        signalLines.push(
          `[${data.name}] (${date}) ${item.title}${item.snippet ? ' — ' + item.snippet.substring(0, 150) : ''}`
        );
      });
    });
    industry.slice(0, 10).forEach((item) => {
      const date = item.pubDate
        ? new Date(item.pubDate).toISOString().split('T')[0]
        : 'unknown';
      signalLines.push(
        `[INDUSTRY] (${date}) ${item.title}${item.snippet ? ' — ' + item.snippet.substring(0, 150) : ''}`
      );
    });

    const signalDigest = signalLines.join('\n');

    const lang = req.query.lang || 'en';

    const previousBriefs = getRecentBriefSummaries(3);
    const continuityContext = previousBriefs
      ? `\n\nPREVIOUS INTELLIGENCE BRIEFS (for continuity - reference changes since last brief, highlight new developments):\n${previousBriefs}\n`
      : '';

    const languageInstruction = lang === 'sv'
      ? 'Write the brief in Swedish (svenska). Use Swedish terminology for defense/military concepts.'
      : 'Write in English.';

    const systemPrompt = `You are a competitive intelligence analyst for Snigel Design AB, a Swedish company (est. 1990, ~365 MSEK revenue, ~25 employees, HQ Farsta) that makes modular tactical carry systems, ballistic vests/plate carriers, and tactical clothing for military and law enforcement. Key products include the Squeeze plate carrier system and Spoon ergonomic load-bearing system. In March 2025, eEquity invested ~50% stake to drive international growth toward 1 BnSEK.

Snigel's primary competitors are:
- NFM Group (Norway, 243 MEUR, 3400+ employees) — full system: THOR carry, SKJOLD ballistic, GARM clothing. Acquired Paul Boyé (France) in Oct 2025. HIGH THREAT.
- Mehler Systems (Germany, 1600+ employees) — includes Lindnerhof Taktik (plate carriers, pouches) and UF PRO (tactical clothing). MOBAST program supplier. HIGH THREAT.
- Lindnerhof Taktik (Germany, part of Mehler) — direct competitor in modular plate carriers and pouches. HIGH THREAT.
- Tasmanian Tiger (Germany, Tatonka group ~1000 emp) — backpacks, pouches, global dealer network, transparent pricing. MEDIUM THREAT.
- Savotta (Finland, 14.5 MEUR) — military packs, M23 framework 37 MEUR, Rite Ventures invested. MEDIUM THREAT.
- Sacci AB (Sweden, ~150 MSEK) — medical/tactical bags, Haglöfs heritage. MEDIUM THREAT.
- Taiga AB (Sweden, ~156 MSEK) — tactical clothing, uniforms, IR/camouflage. MEDIUM THREAT.
- Equipnor AB (Sweden, NFM Group subsidiary) — system integrator for Swedish defense. LOW THREAT.
- PTD Group (Denmark) — defense system integrator, C4ISR. LOW THREAT.

Your role is to produce a concise, executive-level competitive intelligence brief from the latest signals. ${languageInstruction} Be specific, actionable, and focused on implications for Snigel.`;

    const sectionHeaders = lang === 'sv'
      ? {
          priority: 'PRIORITERADE VARNINGAR',
          competitor: 'KONKURRENTRÖRELSER',
          market: 'MARKNADS- & REGULATORISKA SIGNALER',
          strategic: 'STRATEGISKA IMPLIKATIONER FÖR SNIGEL',
          quality: 'SIGNALKVALITETSNOTERING',
        }
      : {
          priority: 'PRIORITY ALERTS',
          competitor: 'COMPETITOR MOVEMENTS',
          market: 'MARKET & REGULATORY SIGNALS',
          strategic: 'STRATEGIC IMPLICATIONS FOR SNIGEL',
          quality: 'SIGNAL QUALITY NOTE',
        };

    const userPrompt = `Here are the latest ${signalLines.length} intelligence signals collected from RSS feeds (today is ${new Date().toISOString().split('T')[0]}):

${signalDigest}
${continuityContext}
Based on these signals, produce a COMPETITIVE INTELLIGENCE BRIEF with these sections:

## ${sectionHeaders.priority}
Signals that require immediate attention from Snigel leadership (competitive moves, lost/won contracts, M&A that changes the landscape).

## ${sectionHeaders.competitor}
Summary of what each active competitor is doing, grouped by company. Only include competitors with actual signals.

## ${sectionHeaders.market}
Broader European defense/procurement trends that affect Snigel's business.

## ${sectionHeaders.strategic}
2-3 concrete, actionable recommendations based on this intelligence cycle.

## ${sectionHeaders.quality}
Brief note on signal coverage gaps or areas where more intelligence is needed.

Keep it concise but substantive. If previous briefs are provided, explicitly note what has CHANGED since the last assessment and highlight NEW developments. Each section should be 3-6 bullet points max. Use markdown formatting.`;

    // Stream the response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const anthropic = new Anthropic();

    const stream = anthropic.messages.stream({
      model: AI_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let fullText = '';
    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('[BRIEF] Stream error:', err.message);
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`
      );
      res.end();
    });

    const finalMessage = await stream.finalMessage();
    res.write(
      `data: ${JSON.stringify({ type: 'done', usage: finalMessage.usage })}\n\n`
    );
    res.end();

    // Save the completed brief
    saveBrief(fullText, finalMessage.usage);

    console.log(
      `[BRIEF] Generated. Tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out`
    );
  } catch (err) {
    console.error('[BRIEF] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    } else {
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`
      );
      res.end();
    }
  }
});

// --- Brief History API ---
app.get('/api/briefs', (req, res) => {
  const briefs = loadBriefs();
  // Return list without full text for efficiency
  const list = briefs.map(b => ({
    id: b.id,
    timestamp: b.timestamp,
    usage: b.usage,
    preview: b.text.substring(0, 200),
  }));
  res.json({ ok: true, briefs: list });
});

app.get('/api/briefs/:id', (req, res) => {
  const filePath = path.join(BRIEFS_DIR, `${req.params.id}.json`);
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'Brief not found' });
    }
    const brief = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json({ ok: true, brief });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Startup ---
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   SNIGEL COMPETITIVE RADAR                  ║
  ║   Intelligence Server v1.0                  ║
  ║──────────────────────────────────────────────║
  ║   Status:  ONLINE                           ║
  ║   Port:    ${String(PORT).padEnd(36)}║
  ║   Cache:   ${String(CACHE_TTL / 60000 + ' min TTL').padEnd(36)}║
  ║   Feeds:   ${String(Object.keys(sources.competitors).length + ' competitors').padEnd(36)}║
  ║   Model:   ${String(AI_MODEL).padEnd(36)}║
  ║   Auth:    ${String(SITE_PASSWORD ? 'PASSWORD' : 'OPEN').padEnd(36)}║
  ╚══════════════════════════════════════════════╝

  Open http://localhost:${PORT} in your browser.
  `);

  // Pre-warm cache
  setTimeout(() => {
    console.log('[INIT] Pre-warming feed cache...');
    Promise.all([fetchCompetitorFeeds(), fetchIndustryFeeds()]).then(() => {
      console.log('[INIT] Cache warmed. Ready for operations.');
    });
  }, 2000);
});
