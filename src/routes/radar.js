const express = require('express');
const feedService = require('../services/feedService');
const classificationService = require('../services/classificationService');
const config = require('../config');

const router = express.Router();

// --- Radar-specific cache ---
const cache = {
  radar: { data: null, timestamp: 0 },
};

function isRadarCacheValid() {
  return cache.radar.data && Date.now() - cache.radar.timestamp < config.cacheTtlMs;
}

function invalidateCache() {
  cache.radar = { data: null, timestamp: 0 };
}

function getRadarCacheStatus() {
  return {
    cached: !!cache.radar.data,
    age: cache.radar.timestamp
      ? Date.now() - cache.radar.timestamp
      : null,
  };
}

// GET /api/radar
router.get('/radar', async (req, res) => {
  try {
    if (isRadarCacheValid()) {
      return res.json({ ok: true, timestamp: cache.radar.timestamp, items: cache.radar.data });
    }

    const { loadSources } = req.app.locals;
    const src = await loadSources();
    const [competitors, industry] = await Promise.all([
      feedService.fetchCompetitorFeeds(src),
      feedService.fetchIndustryFeeds(src),
    ]);

    // Flatten all items with source metadata
    const allItems = [];

    Object.entries(competitors).forEach(([key, data]) => {
      if (!data.items) return;
      data.items.forEach(item => {
        allItems.push({ ...item, _sourceType: 'competitor', _sourceKey: key, _sourceName: data.name });
      });
    });

    industry.forEach(item => {
      allItems.push({ ...item, _sourceType: 'industry' });
    });

    console.log(`[RADAR] Classifying ${allItems.length} items...`);
    const classified = await classificationService.classifyRadarItems(allItems);

    cache.radar = { data: classified, timestamp: Date.now() };
    console.log(`[RADAR] Classification complete. ${classified.length} items on radar.`);

    res.json({ ok: true, timestamp: cache.radar.timestamp, items: classified });
  } catch (err) {
    console.error('[RADAR] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router, invalidateCache, getRadarCacheStatus };
