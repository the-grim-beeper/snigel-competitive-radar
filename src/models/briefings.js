const pool = require('../db/connection');

async function create(data) {
  const { content, model, input_tokens, output_tokens } = data;
  const { rows } = await pool.query(`
    INSERT INTO briefings (content, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4) RETURNING *
  `, [content, model, input_tokens, output_tokens]);
  return rows[0];
}

async function getAll(limit = 20) {
  const { rows } = await pool.query('SELECT id, created_at, input_tokens, output_tokens FROM briefings ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows;
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM briefings WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getRecent(count = 3) {
  const { rows } = await pool.query('SELECT content, created_at FROM briefings ORDER BY created_at DESC LIMIT $1', [count]);
  return rows;
}

module.exports = { create, getAll, getById, getRecent };
