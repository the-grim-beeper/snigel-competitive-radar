const competitorsModel = require('../models/competitors');
const sourcesModel = require('../models/sources');

async function getLegacySourcesFormat() {
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
}

module.exports = { getLegacySourcesFormat };
