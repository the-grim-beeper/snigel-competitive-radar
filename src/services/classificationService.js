const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

const AI_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Classify radar items into quadrants with relevance scores.
 *
 * Falls back to heuristic classification if no ANTHROPIC_API_KEY is set.
 *
 * @param {Array} allItems - Feed items with _sourceType metadata
 * @returns {Array} Items with quadrant, relevance (1-10), and label
 */
async function classifyRadarItems(allItems) {
  // Fallback if no API key
  if (!config.anthropicApiKey) {
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
  for (let i = 0; i < allItems.length; i += config.radarChunkSize) {
    chunks.push(allItems.slice(i, i + config.radarChunkSize));
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

module.exports = {
  classifyRadarItems,
};
