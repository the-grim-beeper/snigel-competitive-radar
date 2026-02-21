-- Competitors
CREATE TABLE competitors (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT,
  flag TEXT,
  founded INT,
  revenue TEXT,
  employees TEXT,
  hq TEXT,
  threat TEXT DEFAULT 'medium',
  color TEXT,
  focus TEXT[] DEFAULT '{}',
  channels TEXT,
  radar_angle REAL,
  radar_dist REAL,
  capabilities JSONB DEFAULT '{}',
  swot JSONB DEFAULT '{}',
  timeline JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sources (RSS feeds + web monitors)
CREATE TABLE sources (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('rss', 'web_monitor')),
  url TEXT NOT NULL,
  name TEXT,
  competitor_key TEXT REFERENCES competitors(key) ON DELETE SET NULL,
  category TEXT DEFAULT 'industry',
  poll_interval_minutes INT DEFAULT 30,
  last_polled_at TIMESTAMPTZ,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sources_type ON sources(type);
CREATE INDEX idx_sources_competitor ON sources(competitor_key);

-- Signals (classified feed/monitor items)
CREATE TABLE signals (
  id SERIAL PRIMARY KEY,
  source_id INT REFERENCES sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  link TEXT,
  pub_date TIMESTAMPTZ,
  snippet TEXT,
  quadrant TEXT NOT NULL CHECK (quadrant IN ('competitors', 'industry', 'snigel', 'anomalies')),
  relevance INT NOT NULL CHECK (relevance BETWEEN 1 AND 10),
  label TEXT,
  source_name TEXT,
  source_type TEXT,
  source_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_signals_quadrant ON signals(quadrant);
CREATE INDEX idx_signals_relevance ON signals(relevance);
CREATE INDEX idx_signals_pub_date ON signals(pub_date);
CREATE INDEX idx_signals_source_key ON signals(source_key);
CREATE UNIQUE INDEX idx_signals_link ON signals(link) WHERE link IS NOT NULL;

-- Web snapshots (for change detection)
CREATE TABLE web_snapshots (
  id SERIAL PRIMARY KEY,
  source_id INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  extracted_text TEXT,
  diff_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_snapshots_source ON web_snapshots(source_id);

-- Briefings (stored AI intelligence briefs)
CREATE TABLE briefings (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  model TEXT,
  input_tokens INT,
  output_tokens INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_briefings_created ON briefings(created_at DESC);

-- Scan runs (audit log)
CREATE TABLE scan_runs (
  id SERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  items_found INT DEFAULT 0,
  items_classified INT DEFAULT 0,
  errors TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
