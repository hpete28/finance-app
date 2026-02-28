// server/index.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const { getDb } = require('./database');
const { importCSV, ACCOUNT_MAP, guessAccountFromFilename } = require('./services/csvParser');
const { seedRulesFromJson, recategorizeAll, detectRecurring } = require('./services/categorizer');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const rulesRouter = require('./routes/rules');

// Middleware
const defaultCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const envCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set([...defaultCorsOrigins, ...envCorsOrigins])];
const basicAuthUser = String(process.env.PUBLIC_BASIC_AUTH_USER || '').trim();
const basicAuthPass = String(process.env.PUBLIC_BASIC_AUTH_PASS || '').trim();
const basicAuthEnabled = Boolean(basicAuthUser && basicAuthPass);

function constantTimeEquals(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseBasicAuth(authorization) {
  if (!authorization || !authorization.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // non-browser / same-origin tools
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
}));
app.use((req, res, next) => {
  if (!basicAuthEnabled) return next();

  const creds = parseBasicAuth(req.headers.authorization);
  if (
    creds &&
    constantTimeEquals(creds.user, basicAuthUser) &&
    constantTimeEquals(creds.pass, basicAuthPass)
  ) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Finance App"');
  return res.status(401).send('Authentication required');
});
app.use(express.json({ limit: '10mb' }));

// File upload config (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Initialize DB ─────────────────────────────────────────────────────────────
getDb(); // Runs schema init

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/categories',   require('./routes/categories'));
app.use('/api/rules',        rulesRouter);
app.use('/api/rulesets',     (req, res, next) => {
  req.url = `/rulesets${req.url}`;
  return rulesRouter(req, res, next);
});
app.use('/api/tag-rules',    require('./routes/tag_rules'));
app.use('/api/budgets',      require('./routes/budgets'));
app.use('/api/analytics', require('./routes/analytics_v2'));
app.use('/api/analytics', require('./routes/analytics_summary'));
app.use('/api/analytics',    require('./routes/analytics'));
app.use('/api/bills',        require('./routes/bills'));
app.use('/api/networth',     require('./routes/networth'));
app.use('/api/income-sources', require('./routes/income_sources'));
app.use('/api/pdf-import',     require('./routes/pdf_import'));
app.use('/api/import-history', require('./routes/import_history'));
app.use('/api/ai',             require('./routes/ai'));

// ─── Upload endpoint ────────────────────────────────────────────────────────────
app.post('/api/upload/transactions', upload.array('files'), async (req, res) => {
  const results = [];
  const errors  = [];

  for (const file of req.files) {
    try {
      const guessedAccount = guessAccountFromFilename(file.originalname);
      const result = await importCSV(file.originalname, file.buffer);
      results.push({ ...result, guessedAccount, originalFilename: file.originalname });
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
    }
  }

  res.json({ results, errors, total_imported: results.reduce((s, r) => s + r.imported, 0) });
});

// ─── Upload categorization rules JSON ──────────────────────────────────────────
app.post('/api/upload/rules', upload.single('file'), (req, res) => {
  try {
    const rulesJson = JSON.parse(req.file.buffer.toString());
    seedRulesFromJson(rulesJson);
    const count = recategorizeAll(false);
    res.json({ ok: true, categorized: count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Seed rules from bundled JSON (call once on first run) ─────────────────────
app.post('/api/setup/seed-rules', (req, res) => {
  try {
    const rulesPath = path.join(__dirname, 'default_rules.json');
    if (fs.existsSync(rulesPath)) {
      const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      seedRulesFromJson(rulesJson);
    }
    const count = recategorizeAll(false);
    res.json({ ok: true, categorized: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const db = getDb();
  const stats = {
    transactions: db.prepare('SELECT COUNT(*) as n FROM transactions').get().n,
    categories:   db.prepare('SELECT COUNT(*) as n FROM categories').get().n,
    rules:        db.prepare('SELECT COUNT(*) as n FROM rules').get().n,
    accounts:     db.prepare('SELECT COUNT(*) as n FROM accounts').get().n,
  };
  res.json({ ok: true, stats });
});

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '../client/dist');
  app.use(express.static(clientBuild));
  app.get('*', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
}

app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n🚀 Finance API running at http://${displayHost}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`   Listening on all interfaces (LAN/Tailscale reachable if firewall allows it).`);
  }
  if (basicAuthEnabled) {
    console.log('   Public basic auth: enabled');
  } else {
    console.log('   Public basic auth: disabled');
  }
  console.log(`   Endpoints: /api/transactions, /api/budgets, /api/analytics, /api/bills, /api/networth`);
  console.log(`   CORS origins: ${allowedOrigins.join(', ')}`);
});
