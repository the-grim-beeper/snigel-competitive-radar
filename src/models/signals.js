const pool = require('../db/connection');

async function create(signal) {
  const { source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key } = signal;
  const { rows } = await pool.query(`
    INSERT INTO signals (source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (link) WHERE link IS NOT NULL DO NOTHING
    RETURNING *
  `, [source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key]);
  return rows[0] || null;
}

async function createBatch(signals) {
  if (!signals.length) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const s of signals) {
      const { rows } = await client.query(`
        INSERT INTO signals (source_id, title, link, pub_date, snippet, quadrant, relevance, label, source_name, source_type, source_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (link) WHERE link IS NOT NULL DO NOTHING
        RETURNING *
      `, [s.source_id, s.title, s.link, s.pub_date, s.snippet, s.quadrant, s.relevance, s.label, s.source_name, s.source_type, s.source_key]);
      if (rows[0]) results.push(rows[0]);
    }
    await client.query('COMMIT');
    return results;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function query({ quadrant, source_key, source_type, min_relevance, max_relevance, from_date, to_date, search, sort_by, sort_dir, limit, offset } = {}) {
  const conditions = [];
  const values = [];
  let i = 1;

  if (quadrant) { conditions.push(`quadrant = $${i++}`); values.push(quadrant); }
  if (source_key) { conditions.push(`source_key = $${i++}`); values.push(source_key); }
  if (source_type) { conditions.push(`source_type = $${i++}`); values.push(source_type); }
  if (min_relevance) { conditions.push(`relevance >= $${i++}`); values.push(min_relevance); }
  if (max_relevance) { conditions.push(`relevance <= $${i++}`); values.push(max_relevance); }
  if (from_date) { conditions.push(`pub_date >= $${i++}`); values.push(from_date); }
  if (to_date) { conditions.push(`pub_date <= $${i++}`); values.push(to_date); }
  if (search) { conditions.push(`(title ILIKE $${i} OR label ILIKE $${i})`); values.push(`%${search}%`); i++; }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderCol = sort_by === 'relevance' ? 'relevance' : 'pub_date';
  const orderDir = sort_dir === 'asc' ? 'ASC' : 'DESC';
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;

  const countResult = await pool.query(`SELECT COUNT(*) FROM signals ${where}`, values);
  const total = parseInt(countResult.rows[0].count, 10);

  values.push(lim, off);
  const { rows } = await pool.query(
    `SELECT * FROM signals ${where} ORDER BY ${orderCol} ${orderDir} NULLS LAST LIMIT $${i++} OFFSET $${i++}`,
    values
  );

  return { items: rows, total, limit: lim, offset: off };
}

async function getRecent(hours = 24) {
  const { rows } = await pool.query(
    `SELECT * FROM signals WHERE created_at > NOW() - INTERVAL '1 hour' * $1 ORDER BY pub_date DESC`,
    [hours]
  );
  return rows;
}

async function existsByLink(link) {
  if (!link) return false;
  const { rows } = await pool.query('SELECT 1 FROM signals WHERE link = $1 LIMIT 1', [link]);
  return rows.length > 0;
}

module.exports = { create, createBatch, query, getRecent, existsByLink };
