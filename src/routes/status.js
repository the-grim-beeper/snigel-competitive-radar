const express = require('express');
const feedService = require('../services/feedService');

const router = express.Router();

// GET /api/status
router.get('/status', (req, res) => {
  const { getRadarCacheStatus } = require('./radar');
  const feedCacheStatus = feedService.getCacheStatus();
  res.json({
    ok: true,
    uptime: process.uptime(),
    cache: {
      ...feedCacheStatus,
      radar: getRadarCacheStatus(),
    },
  });
});

module.exports = { router };
