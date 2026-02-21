const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const migrate = require('./src/db/migrate');

// --- Data paths ---
const SOURCES_FILE = path.join(__dirname, 'data', 'sources.json');
const PROFILES_FILE = path.join(__dirname, 'data', 'profiles.json');
const BRIEFS_DIR = path.join(__dirname, 'data', 'briefs');

// --- Default feed sources (used if sources.json doesn't exist) ---
const DEFAULT_SOURCES = {
  competitors: {
    snigel: {
      name: 'Snigel Design',
      feeds: [
        'https://news.google.com/rss/search?q=%22Snigel+Design%22+OR+%22SNIGEL%22+tactical&hl=en&gl=SE&ceid=SE:en',
        'https://news.google.com/rss/search?q=%22Snigel+Design%22+OR+%22SnigelDesign%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    nfm: {
      name: 'NFM Group',
      feeds: [
        'https://news.google.com/rss/search?q=%22NFM+Group%22+military+OR+defense+OR+tactical&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22NFM+Group%22+OR+%22nfm.no%22&hl=no&gl=NO&ceid=NO:no',
      ],
    },
    mehler: {
      name: 'Mehler Systems',
      feeds: [
        'https://news.google.com/rss/search?q=%22Mehler+Systems%22+OR+%22Mehler+Protection%22&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Mehler+Systems%22+OR+%22Mehler+Vario%22&hl=de&gl=DE&ceid=DE:de',
      ],
    },
    lindnerhof: {
      name: 'Lindnerhof Taktik',
      feeds: [
        'https://news.google.com/rss/search?q=%22Lindnerhof+Taktik%22+OR+%22Lindnerhof-Taktik%22&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Lindnerhof%22+tactical+OR+military&hl=de&gl=DE&ceid=DE:de',
      ],
    },
    sacci: {
      name: 'Sacci AB',
      feeds: [
        'https://news.google.com/rss/search?q=%22Sacci+AB%22+OR+%22Sacci+Pro%22+military+OR+tactical+OR+medical&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Sacci+AB%22+OR+%22Sacci+Pro%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    savotta: {
      name: 'Savotta',
      feeds: [
        'https://news.google.com/rss/search?q=%22Savotta%22+military+OR+defense+OR+tactical+Finland&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Savotta%22+puolustusvoimat+OR+armeija&hl=fi&gl=FI&ceid=FI:fi',
      ],
    },
    taiga: {
      name: 'Taiga AB',
      feeds: [
        'https://news.google.com/rss/search?q=%22Taiga%22+tactical+clothing+military+Sweden&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Taiga+AB%22+OR+%22taiga.se%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    tasmanian_tiger: {
      name: 'Tasmanian Tiger',
      feeds: [
        'https://news.google.com/rss/search?q=%22Tasmanian+Tiger%22+tactical+OR+military+OR+gear&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Tasmanian+Tiger%22+Tatonka+tactical&hl=de&gl=DE&ceid=DE:de',
      ],
    },
    equipnor: {
      name: 'Equipnor',
      feeds: [
        'https://news.google.com/rss/search?q=%22Equipnor%22+military+OR+defense&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Equipnor%22&hl=sv&gl=SE&ceid=SE:sv',
      ],
    },
    ptd: {
      name: 'PTD Group',
      feeds: [
        'https://news.google.com/rss/search?q=%22Precision+Technic+Defence%22+OR+%22PTD+Group%22&hl=en&ceid=US:en',
        'https://news.google.com/rss/search?q=%22Precision+Technic+Defence%22&hl=da&gl=DK&ceid=DK:da',
      ],
    },
    ufpro: {
      name: 'UF PRO',
      feeds: [
        'https://news.google.com/rss/search?q=%22UF+PRO%22+tactical+clothing+military&hl=en&ceid=US:en',
      ],
    },
  },
  industry: [
    'https://news.google.com/rss/search?q=european+defense+equipment+tactical+soldier+modernization&hl=en&ceid=US:en',
    'https://news.google.com/rss/search?q=soldier+equipment+Europe+procurement+2025+OR+2026&hl=en&ceid=US:en',
    'https://news.google.com/rss/search?q=europeisk+f%C3%B6rsvar+upphandling+soldatutrustning&hl=sv&gl=SE&ceid=SE:sv',
    'https://news.google.com/rss/search?q=NATO+soldier+modernization+load+carrying&hl=en&ceid=US:en',
    'https://www.reddit.com/r/tacticalgear/.rss',
  ],
};

// --- Source persistence ---
function loadSources() {
  try {
    if (fs.existsSync(SOURCES_FILE)) {
      return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[SOURCES] Error loading sources.json:', err.message);
  }
  // First run or corrupt file -- seed from defaults
  saveSources(DEFAULT_SOURCES);
  return DEFAULT_SOURCES;
}

function saveSources(sources) {
  const dir = path.dirname(SOURCES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
}

// --- Profile persistence ---
function loadProfiles() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[PROFILES] Error loading profiles.json:', err.message);
  }
  return null; // null means "use frontend defaults"
}

function saveProfiles(profiles) {
  const dir = path.dirname(PROFILES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

// --- Brief directory helper ---
function ensureBriefsDir() {
  if (!fs.existsSync(BRIEFS_DIR)) fs.mkdirSync(BRIEFS_DIR, { recursive: true });
}

// --- Express app ---
const app = express();
app.use(express.json());

// --- Password protection (set SITE_PASSWORD env var to enable) ---
const SITE_PASSWORD = process.env.SITE_PASSWORD;
if (SITE_PASSWORD) {
  const crypto = require('crypto');
  const TOKEN = crypto.createHash('sha256').update(SITE_PASSWORD).digest('hex').slice(0, 32);

  app.post('/login', (req, res) => {
    if (req.body.password === SITE_PASSWORD) {
      res.cookie('auth', TOKEN, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
      return res.json({ ok: true });
    }
    res.status(401).json({ ok: false, error: 'Wrong password' });
  });

  app.use((req, res, next) => {
    if (req.path === '/login') return next();
    const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('auth='));
    if (cookie && cookie.split('=')[1] === TOKEN) return next();
    // Serve login page
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SNIGEL RADAR — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0e14;color:#c8d6e5;font-family:'Oxanium',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;overflow:hidden}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(0,255,136,.04),transparent 60%),radial-gradient(ellipse at 70% 80%,rgba(0,200,255,.03),transparent 60%);pointer-events:none}
.login-box{background:rgba(15,20,30,.9);border:1px solid rgba(0,255,136,.15);border-radius:2px;padding:3rem;width:340px;text-align:center;position:relative}
.login-box::before{content:'';position:absolute;top:-1px;left:20%;right:20%;height:1px;background:linear-gradient(90deg,transparent,rgba(0,255,136,.6),transparent)}
h1{font-size:.85rem;letter-spacing:4px;color:#00ff88;margin-bottom:.3rem;text-transform:uppercase}
.sub{font-family:'Share Tech Mono',monospace;font-size:.65rem;color:#546e7a;letter-spacing:2px;margin-bottom:2rem}
input{width:100%;padding:.75rem 1rem;background:rgba(0,255,136,.03);border:1px solid rgba(0,255,136,.15);border-radius:2px;color:#e8f0f8;font-family:'Share Tech Mono',monospace;font-size:.85rem;outline:none;transition:border-color .2s}
input:focus{border-color:rgba(0,255,136,.5)}
input::placeholder{color:#3a5060}
button{width:100%;margin-top:1rem;padding:.7rem;background:rgba(0,255,136,.1);border:1px solid rgba(0,255,136,.3);color:#00ff88;font-family:'Oxanium',sans-serif;font-size:.8rem;letter-spacing:3px;text-transform:uppercase;cursor:pointer;border-radius:2px;transition:all .2s}
button:hover{background:rgba(0,255,136,.2);border-color:rgba(0,255,136,.5)}
.err{color:#ff4757;font-size:.75rem;margin-top:.75rem;min-height:1.2em;font-family:'Share Tech Mono',monospace}
</style></head>
<body><div class="login-box"><h1>Snigel Radar</h1><div class="sub">COMPETITIVE INTELLIGENCE</div>
<form id="f"><input type="password" name="password" placeholder="Enter password" autofocus autocomplete="current-password">
<button type="submit">AUTHENTICATE</button><div class="err" id="e"></div></form>
<script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:e.target.password.value})});if(r.ok)location.reload();else document.getElementById('e').textContent='ACCESS DENIED';}</script>
</div></body></html>`);
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// --- Expose shared helpers to route files via app.locals ---
app.locals.loadSources = loadSources;
app.locals.saveSources = saveSources;
app.locals.loadProfiles = loadProfiles;
app.locals.saveProfiles = saveProfiles;
app.locals.ensureBriefsDir = ensureBriefsDir;
app.locals.briefsDir = BRIEFS_DIR;

// --- Mount route modules ---
app.use('/api', require('./src/routes/radar').router);
app.use('/api', require('./src/routes/feeds').router);
app.use('/api', require('./src/routes/sources').router);
app.use('/api', require('./src/routes/briefings').router);
app.use('/api', require('./src/routes/profiles').router);
app.use('/api', require('./src/routes/status').router);

// --- Startup ---
async function start() {
  try {
    await migrate();
    console.log('[db] Migrations complete');
  } catch (e) {
    console.warn('[db] Migration skipped:', e.message);
  }

  const sources = loadSources();

  app.listen(config.port, () => {
    console.log(`
  SNIGEL COMPETITIVE RADAR
  Intelligence Server v1.0
  Status:  ONLINE
  Port:    ${config.port}
  Cache:   ${config.cacheTtlMs / 60000} min TTL
  Feeds:   ${Object.keys(sources.competitors).length} competitors
  Auth:    ${SITE_PASSWORD ? 'PASSWORD' : 'OPEN'}

  Open http://localhost:${config.port} in your browser.
    `);
  });

  // Pre-warm feed cache
  setTimeout(async () => {
    try {
      const feedService = require('./src/services/feedService');
      const src = loadSources();
      await feedService.fetchCompetitorFeeds(src);
      await feedService.fetchIndustryFeeds(src);
      console.log('[startup] Feed cache warmed');
    } catch (e) {
      console.error('[startup] Feed warm error:', e.message);
    }
  }, 2000);
}

start();
