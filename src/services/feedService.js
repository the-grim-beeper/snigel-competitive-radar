const RSSParser = require('rss-parser');
const config = require('../config');

const parser = new RSSParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'SnigelRadar/1.0 (Competitive Intelligence)',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

// --- In-memory feed cache ---
const cache = {
  competitors: { data: null, timestamp: 0 },
  industry: { data: null, timestamp: 0 },
};

function isCacheValid(key) {
  return cache[key].data && Date.now() - cache[key].timestamp < config.cacheTtlMs;
}

/**
 * Parse a single RSS feed URL and return normalised items.
 */
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

/**
 * Fetch all competitor feeds, deduplicate, and cache for cacheTtlMs.
 * @param {object} sources - The full sources object (with .competitors and .industry)
 */
async function fetchCompetitorFeeds(sources) {
  if (isCacheValid('competitors')) return cache.competitors.data;

  console.log('[SCAN] Fetching competitor feeds...');
  const results = {};

  const entries = Object.entries(sources.competitors);
  for (const [key, feedConfig] of entries) {
    const allItems = [];
    for (const feedUrl of feedConfig.feeds) {
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
      name: feedConfig.name,
      items: unique.slice(0, 15), // Keep top 15 per competitor
    };
  }

  cache.competitors = { data: results, timestamp: Date.now() };
  console.log(
    `[SCAN] Complete. Found items for ${Object.keys(results).length} competitors.`
  );
  return results;
}

/**
 * Fetch all industry feeds, deduplicate, and cache for cacheTtlMs.
 * @param {object} sources - The full sources object (with .competitors and .industry)
 */
async function fetchIndustryFeeds(sources) {
  if (isCacheValid('industry')) return cache.industry.data;

  console.log('[SCAN] Fetching industry feeds...');
  const allItems = [];

  for (const feedUrl of sources.industry) {
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

/**
 * Invalidate all feed caches (competitor + industry).
 */
function invalidateCache() {
  cache.competitors = { data: null, timestamp: 0 };
  cache.industry = { data: null, timestamp: 0 };
}

/**
 * Expose the parser for use in feed discovery (search endpoint).
 */
function getParser() {
  return parser;
}

/**
 * Return cache metadata (for status endpoint).
 */
function getCacheStatus() {
  return {
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
  };
}

module.exports = {
  fetchFeed,
  fetchCompetitorFeeds,
  fetchIndustryFeeds,
  invalidateCache,
  getParser,
  getCacheStatus,
};
