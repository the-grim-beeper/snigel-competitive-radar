const pool = require('../db/connection');

async function create(data) {
  const { source_id, content_hash, extracted_text, diff_summary } = data;
  const { rows } = await pool.query(`
    INSERT INTO web_snapshots (source_id, content_hash, extracted_text, diff_summary)
    VALUES ($1,$2,$3,$4) RETURNING *
  `, [source_id, content_hash, extracted_text, diff_summary]);
  return rows[0];
}

async function getLatest(sourceId) {
  const { rows } = await pool.query(
    'SELECT * FROM web_snapshots WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sourceId]
  );
  return rows[0] || null;
}

module.exports = { create, getLatest };
