const { Pool } = require('pg');
const config = require('../config');

const poolConfig = { connectionString: config.databaseUrl };

if (config.databaseUrl.includes('railway') || process.env.RAILWAY_ENVIRONMENT) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

module.exports = pool;
