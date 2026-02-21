const pool = require('../db/connection');

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM sources WHERE enabled = TRUE ORDER BY category, name');
  return rows;
}

async function getByType(type) {
  const { rows } = await pool.query('SELECT * FROM sources WHERE type = $1 AND enabled = TRUE', [type]);
  return rows;
}

async function getByCompetitor(competitorKey) {
  const { rows } = await pool.query('SELECT * FROM sources WHERE competitor_key = $1 AND enabled = TRUE', [competitorKey]);
  return rows;
}

async function getCompetitorSources() {
  const { rows } = await pool.query("SELECT * FROM sources WHERE category = 'competitor' AND enabled = TRUE ORDER BY competitor_key");
  return rows;
}

async function getIndustrySources() {
  const { rows } = await pool.query("SELECT * FROM sources WHERE category = 'industry' AND enabled = TRUE ORDER BY name");
  return rows;
}

async function create(data) {
  const { type, url, name, competitor_key, category, poll_interval_minutes } = data;
  const { rows } = await pool.query(`
    INSERT INTO sources (type, url, name, competitor_key, category, poll_interval_minutes)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [type || 'rss', url, name, competitor_key, category || 'industry', poll_interval_minutes || 30]);
  return rows[0];
}

async function update(id, data) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = $${i}`);
    values.push(val);
    i++;
  }
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE sources SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0];
}

async function remove(id) {
  await pool.query('DELETE FROM sources WHERE id = $1', [id]);
}

async function removeByUrl(url) {
  await pool.query('DELETE FROM sources WHERE url = $1', [url]);
}

async function removeByCompetitorKey(competitorKey) {
  await pool.query('DELETE FROM sources WHERE competitor_key = $1', [competitorKey]);
}

async function findByUrl(url) {
  const { rows } = await pool.query('SELECT * FROM sources WHERE url = $1', [url]);
  return rows[0] || null;
}

async function markPolled(id) {
  await pool.query('UPDATE sources SET last_polled_at = NOW() WHERE id = $1', [id]);
}

module.exports = { getAll, getByType, getByCompetitor, getCompetitorSources, getIndustrySources, create, update, remove, removeByUrl, removeByCompetitorKey, findByUrl, markPolled };
