const express = require('express');
const RSSParser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new RSSParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'SnigelRadar/1.0 (Competitive Intelligence)',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

const PORT = process.env.PORT || 3000;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// --- Competitor feed configuration ---
const COMPETITOR_FEEDS = {
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
};

// Industry-wide feeds
const INDUSTRY_FEEDS = [
  'https://news.google.com/rss/search?q=european+defense+equipment+tactical+soldier+modernization&hl=en&ceid=US:en',
  'https://news.google.com/rss/search?q=soldier+equipment+Europe+procurement+2025+OR+2026&hl=en&ceid=US:en',
  'https://news.google.com/rss/search?q=europeisk+f%C3%B6rsvar+upphandling+soldatutrustning&hl=sv&gl=SE&ceid=SE:sv',
  'https://news.google.com/rss/search?q=NATO+soldier+modernization+load+carrying&hl=en&ceid=US:en',
];

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

  const entries = Object.entries(COMPETITOR_FEEDS);
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

  for (const feedUrl of INDUSTRY_FEEDS) {
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
  ║   Feeds:   ${String(Object.keys(COMPETITOR_FEEDS).length + ' competitors').padEnd(36)}║
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
