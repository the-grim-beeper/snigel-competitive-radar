const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const feedService = require('../services/feedService');
const { invalidateCache: invalidateRadarCache } = require('./radar');

const router = express.Router();

const AI_MODEL = 'claude-sonnet-4-5-20250929';

// GET /api/sources
router.get('/sources', (req, res) => {
  const { loadSources } = req.app.locals;
  const sources = loadSources();
  res.json({ ok: true, sources });
});

// PUT /api/sources
router.put('/sources', (req, res) => {
  const { loadSources, saveSources } = req.app.locals;
  const updated = req.body;
  if (!updated || !updated.competitors || !updated.industry) {
    return res.status(400).json({ ok: false, error: 'Invalid sources format' });
  }
  saveSources(updated);
  // Invalidate feed caches so next scan uses new sources
  feedService.invalidateCache();
  invalidateRadarCache();
  console.log('[SOURCES] Updated and saved. Cache invalidated.');
  res.json({ ok: true });
});

// POST /api/sources/add-competitor
router.post('/sources/add-competitor', (req, res) => {
  const { loadSources, saveSources } = req.app.locals;
  const { key, name, feeds } = req.body;
  if (!key || !name || !Array.isArray(feeds)) {
    return res.status(400).json({ ok: false, error: 'Requires key, name, feeds[]' });
  }
  const sources = loadSources();
  const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  sources.competitors[safeKey] = { name, feeds };
  saveSources(sources);
  feedService.invalidateCache();
  invalidateRadarCache();
  console.log(`[SOURCES] Added competitor: ${name} (${safeKey})`);
  res.json({ ok: true, key: safeKey });
});

// DELETE /api/sources/competitor/:key
router.delete('/sources/competitor/:key', (req, res) => {
  const { loadSources, saveSources } = req.app.locals;
  const { key } = req.params;
  const sources = loadSources();
  if (!sources.competitors[key]) {
    return res.status(404).json({ ok: false, error: 'Competitor not found' });
  }
  delete sources.competitors[key];
  saveSources(sources);
  feedService.invalidateCache();
  invalidateRadarCache();
  console.log(`[SOURCES] Removed competitor: ${key}`);
  res.json({ ok: true });
});

// POST /api/sources/add-industry
router.post('/sources/add-industry', (req, res) => {
  const { loadSources, saveSources } = req.app.locals;
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Requires url' });
  }
  const sources = loadSources();
  if (!sources.industry.includes(url)) {
    sources.industry.push(url);
    saveSources(sources);
    feedService.invalidateCache();
    invalidateRadarCache();
  }
  res.json({ ok: true });
});

// DELETE /api/sources/industry
router.delete('/sources/industry', (req, res) => {
  const { loadSources, saveSources } = req.app.locals;
  const { url } = req.body;
  const sources = loadSources();
  sources.industry = sources.industry.filter((u) => u !== url);
  saveSources(sources);
  feedService.invalidateCache();
  invalidateRadarCache();
  res.json({ ok: true });
});

// POST /api/sources/suggest — AI Source Suggestions
router.post('/sources/suggest', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'ANTHROPIC_API_KEY not set.',
    });
  }

  try {
    const { loadSources } = req.app.locals;
    const sources = loadSources();
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

// POST /api/sources/search — Feed Search / Discovery
router.post('/sources/search', async (req, res) => {
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
        const feed = await feedService.getParser().parseURL(url);
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

module.exports = { router };
