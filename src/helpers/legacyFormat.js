const fs = require('fs');
const path = require('path');
const competitorsModel = require('../models/competitors');
const sourcesModel = require('../models/sources');

const SOURCES_FILE = path.join(__dirname, '../../data/sources.json');

function loadSourcesFromFile() {
  try {
    if (fs.existsSync(SOURCES_FILE)) {
      return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[sources] Error reading sources.json:', e.message);
  }
  return { competitors: {}, industry: [] };
}

async function getLegacySourcesFormat() {
  try {
    const allSources = await sourcesModel.getAll();
    const allCompetitors = await competitorsModel.getAll();

    const competitors = {};
    for (const comp of allCompetitors) {
      const feeds = allSources
        .filter(s => s.competitor_key === comp.key && s.type === 'rss')
        .map(s => s.url);
      competitors[comp.key] = { name: comp.name, feeds };
    }

    const industry = allSources
      .filter(s => s.category === 'industry' && s.type === 'rss')
      .map(s => s.url);

    return { competitors, industry };
  } catch (e) {
    console.warn('[sources] DB unavailable, falling back to sources.json:', e.message);
    return loadSourcesFromFile();
  }
}

module.exports = { getLegacySourcesFormat };
