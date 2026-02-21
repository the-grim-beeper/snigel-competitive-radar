const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

const AI_MODEL = 'claude-sonnet-4-5-20250929';

// GET /api/profiles
router.get('/profiles', (req, res) => {
  const { loadProfiles } = req.app.locals;
  const profiles = loadProfiles();
  res.json({ ok: true, profiles }); // null means frontend should use defaults
});

// PUT /api/profiles — Save all profiles
router.put('/profiles', (req, res) => {
  const { saveProfiles } = req.app.locals;
  const profiles = req.body;
  if (!profiles || !profiles.competitors) {
    return res.status(400).json({ ok: false, error: 'Invalid profiles format' });
  }
  saveProfiles(profiles);
  console.log('[PROFILES] Saved all profiles.');
  res.json({ ok: true });
});

// PUT /api/profiles/:key — Update single profile
router.put('/profiles/:key', (req, res) => {
  const { loadProfiles, saveProfiles } = req.app.locals;
  const { key } = req.params;
  const profileData = req.body;
  if (!profileData || !profileData.name) {
    return res.status(400).json({ ok: false, error: 'Invalid profile data' });
  }
  let profiles = loadProfiles();
  if (!profiles) {
    return res.status(400).json({ ok: false, error: 'No profiles saved yet. Save full profiles first.' });
  }
  profiles.competitors[key] = profileData;
  saveProfiles(profiles);
  console.log(`[PROFILES] Updated: ${profileData.name} (${key})`);
  res.json({ ok: true });
});

// POST /api/profiles — Add new profile
router.post('/profiles', (req, res) => {
  const { loadProfiles, saveProfiles } = req.app.locals;
  const { key, profile } = req.body;
  if (!key || !profile || !profile.name) {
    return res.status(400).json({ ok: false, error: 'Requires key and profile with name' });
  }
  let profiles = loadProfiles();
  if (!profiles) {
    return res.status(400).json({ ok: false, error: 'No profiles saved yet. Save full profiles first.' });
  }
  const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (profiles.competitors[safeKey]) {
    return res.status(409).json({ ok: false, error: 'Competitor key already exists' });
  }
  profiles.competitors[safeKey] = profile;
  saveProfiles(profiles);
  console.log(`[PROFILES] Added: ${profile.name} (${safeKey})`);
  res.json({ ok: true, key: safeKey });
});

// DELETE /api/profiles/:key
router.delete('/profiles/:key', (req, res) => {
  const { loadProfiles, saveProfiles } = req.app.locals;
  const { key } = req.params;
  let profiles = loadProfiles();
  if (!profiles || !profiles.competitors[key]) {
    return res.status(404).json({ ok: false, error: 'Profile not found' });
  }
  const name = profiles.competitors[key].name;
  delete profiles.competitors[key];
  saveProfiles(profiles);
  console.log(`[PROFILES] Deleted: ${name} (${key})`);
  res.json({ ok: true });
});

// POST /api/profiles/scan — AI Competitor Scanner
router.post('/profiles/scan', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ ok: false, error: 'ANTHROPIC_API_KEY not set.' });
  }

  try {
    const { loadProfiles } = req.app.locals;
    const lang = req.body.lang || 'en';
    const profiles = loadProfiles();
    const currentList = profiles
      ? Object.entries(profiles.competitors).map(([k, c]) => `- ${c.name} (${c.country}, ${c.revenue}): ${c.focus?.join(', ')}`).join('\n')
      : 'No profiles saved yet.';

    const langInstr = lang === 'sv' ? '\n\nRespond entirely in Swedish.' : '';

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: `You are a competitive intelligence analyst specializing in the European military and tactical equipment industry. You help identify competitors for Snigel Design AB, a Swedish manufacturer of modular tactical carry systems, ballistic protection, and tactical clothing.${langInstr}`,
      messages: [{
        role: 'user',
        content: `Here are the competitors currently tracked:

${currentList}

Identify 3-5 additional competitors that Snigel should monitor. Focus on:
1. European tactical gear manufacturers (carry systems, plate carriers, pouches, tactical clothing)
2. Companies competing in military procurement tenders against Snigel
3. Companies with overlapping product portfolios in the Nordic/European defense market

For each competitor, provide a complete profile as JSON. Return ONLY a JSON array with this structure for each:
{
  "key": "snake_case_key",
  "name": "Company Name",
  "country": "Country",
  "flag": "XX",
  "founded": 2000,
  "revenue": "estimated revenue string",
  "employees": "employee count string",
  "hq": "City, Country",
  "threat": "high|medium|low",
  "color": "#hexcolor",
  "focus": ["Product Category 1", "Product Category 2", "Product Category 3"],
  "channels": "Distribution description",
  "radarAngle": 180,
  "radarDist": 0.5,
  "capabilities": {"breadth": 5, "scale": 5, "certs": 5, "price": 5, "reach": 5, "innovation": 5},
  "swot": {"s": "Strengths text", "w": "Weaknesses text", "o": "Opportunities text", "t": "Threats text"},
  "timeline": [{"date": "2020", "text": "Event description"}],
  "reason": "Why Snigel should monitor this competitor"
}

radarAngle should be 0-360 (position on the radar), radarDist should be 0.2-0.8 (0=center=highest threat, 1=edge=lowest). capabilities scores are 1-10. Choose colors that are visually distinct from existing competitors. Return raw JSON array only, no markdown fences.`
      }],
    });

    const text = response.content[0].text.trim();
    let suggestions;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      suggestions = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ ok: false, error: 'AI returned invalid JSON', raw: text });
    }

    res.json({ ok: true, suggestions, usage: response.usage });
  } catch (err) {
    console.error('[SCAN-COMPETITORS] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = { router };
