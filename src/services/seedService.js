const fs = require('fs');
const path = require('path');
const pool = require('../db/connection');
const competitorsModel = require('../models/competitors');
const sourcesModel = require('../models/sources');

async function seedFromFile() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM sources');
  if (parseInt(rows[0].count, 10) > 0) {
    console.log('[seed] Database already has sources, skipping seed');
    return;
  }

  const filePath = path.join(__dirname, '../../data/sources.json');
  if (!fs.existsSync(filePath)) {
    console.log('[seed] No sources.json found, skipping seed');
    return;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log('[seed] Seeding database from sources.json...');

  for (const [key, comp] of Object.entries(data.competitors || {})) {
    await competitorsModel.upsert(key, { name: comp.name || key });
    for (const url of (comp.feeds || [])) {
      await sourcesModel.create({
        type: 'rss',
        url,
        name: comp.name || key,
        competitor_key: key,
        category: 'competitor',
      });
    }
  }

  for (const url of (data.industry || [])) {
    await sourcesModel.create({
      type: 'rss',
      url,
      name: 'Industry',
      category: 'industry',
    });
  }

  console.log('[seed] Seeding complete');
}

module.exports = { seedFromFile };
