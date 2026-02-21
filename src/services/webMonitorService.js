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
      title: 'Web change: ' + (source.name || source.url),
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
