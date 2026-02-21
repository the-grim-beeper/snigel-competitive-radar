const express = require('express');
const feedService = require('../services/feedService');

const router = express.Router();

// GET /api/feeds/competitors
router.get('/feeds/competitors', async (req, res) => {
  try {
    const { loadSources } = req.app.locals;
    const data = await feedService.fetchCompetitorFeeds(await loadSources());
    res.json({
      ok: true,
      timestamp: Date.now(),
      data,
    });
  } catch (err) {
    console.error('Competitor feed error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/feeds/industry
router.get('/feeds/industry', async (req, res) => {
  try {
    const { loadSources } = req.app.locals;
    const data = await feedService.fetchIndustryFeeds(await loadSources());
    res.json({
      ok: true,
      timestamp: Date.now(),
      data,
    });
  } catch (err) {
    console.error('Industry feed error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/feeds/all
router.get('/feeds/all', async (req, res) => {
  try {
    const { loadSources } = req.app.locals;
    const src = await loadSources();
    const [competitors, industry] = await Promise.all([
      feedService.fetchCompetitorFeeds(src),
      feedService.fetchIndustryFeeds(src),
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

module.exports = { router };
