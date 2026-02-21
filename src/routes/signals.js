const { Router } = require('express');
const signalsModel = require('../models/signals');

const router = Router();

// GET /api/signals?quadrant=competitors&source_key=nfm&min_relevance=5&search=armor&sort_by=date&limit=50&offset=0
router.get('/signals', async (req, res) => {
  try {
    const result = await signalsModel.query({
      quadrant: req.query.quadrant,
      source_key: req.query.source_key,
      source_type: req.query.source_type,
      min_relevance: req.query.min_relevance ? parseInt(req.query.min_relevance, 10) : undefined,
      max_relevance: req.query.max_relevance ? parseInt(req.query.max_relevance, 10) : undefined,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
      search: req.query.search,
      sort_by: req.query.sort_by || 'date',
      sort_dir: req.query.sort_dir || 'desc',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[signals]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = { router };
