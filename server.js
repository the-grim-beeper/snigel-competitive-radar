const express = require('express');
const RSSParser = require('rss-parser');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

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

// Convenience accessors (so existing fetch code works unchanged)
function getCompetitorFeeds() { return sources.competitors; }
function getIndustryFeeds() { return sources.industry; }

// --- Cache ---
const cache = {
  competitors: { data: null, timestamp: 0 },
  industry: { data: null, timestamp: 0 },
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
  }
  res.json({ ok: true });
});

app.delete('/api/sources/industry', (req, res) => {
  const { url } = req.body;
  sources.industry = sources.industry.filter((u) => u !== url);
  saveSources(sources);
  cache.industry = { data: null, timestamp: 0 };
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
    const currentCompetitors = Object.entries(sources.competitors)
      .map(([key, c]) => `- ${c.name} (${key}): ${c.feeds.length} feeds`)
      .join('\n');
    const currentIndustry = sources.industry
      .map((u, i) => `- Feed ${i + 1}: ${u}`)
      .join('\n');

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      system: `You are an OSINT analyst specializing in European defense and tactical equipment industries. You help configure RSS feed sources for competitive intelligence monitoring of Snigel Design AB (Swedish tactical gear manufacturer).

You know that Google News RSS works with this format:
https://news.google.com/rss/search?q=SEARCH_QUERY&hl=LANG&gl=COUNTRY&ceid=COUNTRY:LANG

URL-encode search terms. Use quotes (%22) for exact matches. Use OR for alternatives. Common languages: en, sv, de, no, fi, da, fr.`,
      messages: [{
        role: 'user',
        content: `Here are the current sources being monitored:

COMPETITOR FEEDS:
${currentCompetitors}

INDUSTRY FEEDS:
${currentIndustry}

Analyze the current coverage and suggest 5-8 new RSS feed sources that would improve intelligence coverage. Consider:
1. Gaps in competitor monitoring (missing languages, alternative search terms)
2. New competitors not yet tracked
3. Industry/procurement sources (EU defense tenders, NATO procurement, trade publications)
4. Event/conference feeds (Eurosatory, DSEI, Enforce Tac)

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

Your role is to produce a concise, executive-level competitive intelligence brief from the latest signals. Write in English. Be specific, actionable, and focused on implications for Snigel.`;

    const userPrompt = `Here are the latest ${signalLines.length} intelligence signals collected from RSS feeds (today is ${new Date().toISOString().split('T')[0]}):

${signalDigest}

Based on these signals, produce a COMPETITIVE INTELLIGENCE BRIEF with these sections:

## PRIORITY ALERTS
Signals that require immediate attention from Snigel leadership (competitive moves, lost/won contracts, M&A that changes the landscape).

## COMPETITOR MOVEMENTS
Summary of what each active competitor is doing, grouped by company. Only include competitors with actual signals.

## MARKET & REGULATORY SIGNALS
Broader European defense/procurement trends that affect Snigel's business.

## STRATEGIC IMPLICATIONS FOR SNIGEL
2-3 concrete, actionable recommendations based on this intelligence cycle.

## SIGNAL QUALITY NOTE
Brief note on signal coverage gaps or areas where more intelligence is needed.

Keep it concise but substantive. Each section should be 3-6 bullet points max. Use markdown formatting.`;

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

    stream.on('text', (text) => {
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
