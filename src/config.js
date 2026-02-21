const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/snigel_radar',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  cacheTtlMs: 15 * 60 * 1000,
  radarChunkSize: 40,
  pollIntervalMinutes: 30,
};
module.exports = config;
