const pool = require('../db/connection');

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM competitors ORDER BY name');
  return rows;
}

async function getByKey(key) {
  const { rows } = await pool.query('SELECT * FROM competitors WHERE key = $1', [key]);
  return rows[0] || null;
}

async function upsert(key, data) {
  const { name, country, flag, founded, revenue, employees, hq, threat, color, focus, channels, radar_angle, radar_dist, capabilities, swot, timeline } = data;
  const { rows } = await pool.query(`
    INSERT INTO competitors (key, name, country, flag, founded, revenue, employees, hq, threat, color, focus, channels, radar_angle, radar_dist, capabilities, swot, timeline)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (key) DO UPDATE SET
      name=EXCLUDED.name, country=EXCLUDED.country, flag=EXCLUDED.flag, founded=EXCLUDED.founded,
      revenue=EXCLUDED.revenue, employees=EXCLUDED.employees, hq=EXCLUDED.hq, threat=EXCLUDED.threat,
      color=EXCLUDED.color, focus=EXCLUDED.focus, channels=EXCLUDED.channels,
      radar_angle=EXCLUDED.radar_angle, radar_dist=EXCLUDED.radar_dist,
      capabilities=EXCLUDED.capabilities, swot=EXCLUDED.swot, timeline=EXCLUDED.timeline,
      updated_at=NOW()
    RETURNING *
  `, [key, name, country, flag, founded, revenue, employees, hq, threat, color, focus || [], channels, radar_angle, radar_dist, capabilities || {}, swot || {}, timeline || '[]']);
  return rows[0];
}

async function remove(key) {
  await pool.query('DELETE FROM competitors WHERE key = $1', [key]);
}

module.exports = { getAll, getByKey, upsert, remove };
