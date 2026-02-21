const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const feedService = require('../services/feedService');
const briefingsModel = require('../models/briefings');

const router = express.Router();

const AI_MODEL = 'claude-sonnet-4-5-20250929';

// --- Brief context helper (PostgreSQL) ---

async function getRecentBriefSummaries(count = 3) {
  const recent = await briefingsModel.getRecent(count);
  if (recent.length === 0) return '';
  return recent.map(b => b.content.slice(0, 800)).join('\n---\n');
}

// GET /api/brief — AI Brief (streaming)
router.get('/brief', async (req, res) => {
  // Require API key via env var
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({
      ok: false,
      error: 'ANTHROPIC_API_KEY not set. Start server with: ANTHROPIC_API_KEY=sk-... npm start',
    });
  }

  const { loadSources } = req.app.locals;

  try {
    const src = loadSources();
    const [competitors, industry] = await Promise.all([
      feedService.fetchCompetitorFeeds(src),
      feedService.fetchIndustryFeeds(src),
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

    const previousBriefs = await getRecentBriefSummaries(3);
    const continuityContext = previousBriefs
      ? `\n\nPREVIOUS INTELLIGENCE BRIEFS (for continuity - reference changes since last brief, highlight new developments):\n${previousBriefs}\n`
      : '';

    const languageInstruction = lang === 'sv'
      ? 'Write the brief in Swedish (svenska). Use Swedish terminology for defense/military concepts.'
      : 'Write in English.';

    const systemPrompt = `You are a competitive intelligence analyst for Snigel Design AB, a Swedish company (est. 1990, ~365 MSEK revenue, ~25 employees, HQ Farsta) that makes modular tactical carry systems, ballistic vests/plate carriers, and tactical clothing for military and law enforcement. Key products include the Squeeze plate carrier system and Spoon ergonomic load-bearing system. In March 2025, eEquity invested ~50% stake to drive international growth toward 1 BnSEK.

Snigel's primary competitors are:
- NFM Group (Norway, 243 MEUR, 3400+ employees) — full system: THOR carry, SKJOLD ballistic, GARM clothing. Acquired Paul Boy\u00e9 (France) in Oct 2025. HIGH THREAT.
- Mehler Systems (Germany, 1600+ employees) — includes Lindnerhof Taktik (plate carriers, pouches) and UF PRO (tactical clothing). MOBAST program supplier. HIGH THREAT.
- Lindnerhof Taktik (Germany, part of Mehler) — direct competitor in modular plate carriers and pouches. HIGH THREAT.
- Tasmanian Tiger (Germany, Tatonka group ~1000 emp) — backpacks, pouches, global dealer network, transparent pricing. MEDIUM THREAT.
- Savotta (Finland, 14.5 MEUR) — military packs, M23 framework 37 MEUR, Rite Ventures invested. MEDIUM THREAT.
- Sacci AB (Sweden, ~150 MSEK) — medical/tactical bags, Hagl\u00f6fs heritage. MEDIUM THREAT.
- Taiga AB (Sweden, ~156 MSEK) — tactical clothing, uniforms, IR/camouflage. MEDIUM THREAT.
- Equipnor AB (Sweden, NFM Group subsidiary) — system integrator for Swedish defense. LOW THREAT.
- PTD Group (Denmark) — defense system integrator, C4ISR. LOW THREAT.

Your role is to produce a concise, executive-level competitive intelligence brief from the latest signals. ${languageInstruction} Be specific, actionable, and focused on implications for Snigel.`;

    const sectionHeaders = lang === 'sv'
      ? {
          priority: 'PRIORITERADE VARNINGAR',
          competitor: 'KONKURRENTR\u00d6RELSER',
          market: 'MARKNADS- & REGULATORISKA SIGNALER',
          strategic: 'STRATEGISKA IMPLIKATIONER F\u00d6R SNIGEL',
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

    // Save the completed brief to PostgreSQL
    try {
      await briefingsModel.create({
        content: fullText,
        model: 'claude-sonnet-4-5-20250514',
        input_tokens: finalMessage.usage.input_tokens || 0,
        output_tokens: finalMessage.usage.output_tokens || 0,
      });
    } catch (e) {
      console.error('[brief] DB save error:', e.message);
    }

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

// GET /api/briefs — Brief History (from PostgreSQL)
router.get('/briefs', async (req, res) => {
  try {
    const briefs = await briefingsModel.getAll();
    const list = briefs.map(b => ({
      id: b.id,
      timestamp: b.created_at,
      usage: { in: b.input_tokens, out: b.output_tokens },
    }));
    res.json({ ok: true, briefs: list });
  } catch (err) {
    console.error('[briefs] List error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/briefs/:id (from PostgreSQL)
router.get('/briefs/:id', async (req, res) => {
  try {
    const brief = await briefingsModel.getById(req.params.id);
    if (!brief) {
      return res.status(404).json({ ok: false, error: 'Brief not found' });
    }
    res.json({
      ok: true,
      id: brief.id,
      timestamp: brief.created_at,
      text: brief.content,
      usage: { in: brief.input_tokens, out: brief.output_tokens },
    });
  } catch (err) {
    console.error('[briefs] GetById error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router };
