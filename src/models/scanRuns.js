const pool = require('../db/connection');

async function create(data) {
  const { run_type, items_found, items_classified, errors, duration_ms } = data;
  const { rows } = await pool.query(`
    INSERT INTO scan_runs (run_type, items_found, items_classified, errors, duration_ms)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [run_type, items_found || 0, items_classified || 0, errors, duration_ms]);
  return rows[0];
}

async function getRecent(limit = 10) {
  const { rows } = await pool.query('SELECT * FROM scan_runs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

module.exports = { create, getRecent };
