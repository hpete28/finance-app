const express = require('express');
const router = express.Router();

const { getDb } = require('../database');
const { getAiConfig } = require('../services/ai/config');
const { getAiStatus } = require('../services/ai/orchestrator');
const { suggestTransactionUpdates } = require('../services/ai/transactionSuggestor');

function parseTags(rawTags) {
  try {
    const parsed = JSON.parse(rawTags || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeHistoryKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function buildHistoricalCategoryHints(db, transactions) {
  const hints = new Map();
  if (!Array.isArray(transactions) || !transactions.length) return hints;

  const stmt = db.prepare(`
    SELECT
      t.category_id,
      c.name as category_name,
      COUNT(*) as n
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.category_id IS NOT NULL
      AND t.id != ?
      AND UPPER(TRIM(COALESCE(NULLIF(t.merchant_name, ''), t.description))) = UPPER(TRIM(?))
    GROUP BY t.category_id, c.name
    ORDER BY n DESC
    LIMIT 3
  `);

  for (const tx of transactions) {
    const key = normalizeHistoryKey(tx.merchant_name || tx.description);
    if (!key) continue;

    const rows = stmt.all(tx.id, key);
    if (!rows.length) continue;

    const total = rows.reduce((sum, row) => sum + Number(row.n || 0), 0);
    const top = rows[0];
    const supportCount = Number(top.n || 0);
    const ratio = total > 0 ? supportCount / total : 0;

    hints.set(String(tx.id), {
      key,
      category_id: top.category_id,
      category_name: top.category_name,
      support_count: supportCount,
      total_count: total,
      support_ratio: ratio,
    });
  }

  return hints;
}

router.get('/status', async (req, res) => {
  try {
    const config = getAiConfig();
    const status = await getAiStatus(config);
    res.json({
      ...status,
      timeout_ms: {
        ollama: config.providers?.ollama?.timeoutMs ?? config.timeoutMs,
        gemini: config.providers?.gemini?.timeoutMs ?? null,
      },
      max_batch: config.maxBatch,
    });
  } catch (err) {
    console.error('AI status check failed:', err);
    res.status(500).json({
      code: 'AI_STATUS_FAILED',
      error: err?.message || 'Failed to check AI status',
    });
  }
});

router.post('/suggestions/transactions', async (req, res) => {
  try {
    const config = getAiConfig();
    if (!config.enabled) {
      return res.status(503).json({
        code: 'AI_DISABLED',
        error: 'AI features are disabled by AI_FEATURES_ENABLED',
      });
    }

    const availability = await getAiStatus(config);
    if (!availability.available) {
      return res.status(503).json({
        code: 'AI_UNAVAILABLE',
        error: availability.error || 'No AI providers are available',
        status: availability,
      });
    }

    const inputIds = Array.isArray(req.body?.transaction_ids) ? req.body.transaction_ids : [];
    const ids = [...new Set(inputIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) {
      return res.status(400).json({ error: 'transaction_ids is required' });
    }
    if (ids.length > config.maxBatch) {
      return res.status(400).json({ error: `Too many transactions. Max ${config.maxBatch}` });
    }

    const includeCategorized = asBool(req.body?.include_categorized, false);
    const db = getDb();

    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT
        t.id, t.date, t.description, t.amount, a.currency as currency, t.category_id,
        t.tags, t.merchant_name, t.account_id,
        a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id IN (${placeholders})
    `).all(...ids);

    const missingCount = Math.max(0, ids.length - rows.length);
    const eligible = includeCategorized ? rows : rows.filter((r) => !r.category_id);
    const categorizedSkipped = rows.length - eligible.length;

    if (!eligible.length) {
      return res.json({
        provider: config.primaryProvider,
        provider_used: null,
        fallback_used: false,
        model: null,
        requested_count: ids.length,
        analyzed_count: 0,
        skipped: { missing: missingCount, categorized: categorizedSkipped },
        privacy: { amount_shared: false },
        attempts: [],
        suggestions: [],
      });
    }

    const categories = db.prepare(`
      SELECT id, name
      FROM categories
      ORDER BY name COLLATE NOCASE ASC
    `).all();
    const historicalHints = buildHistoricalCategoryHints(db, eligible);

    const result = await suggestTransactionUpdates({
      config,
      categories,
      historicalHints,
      transactions: eligible.map((r) => ({ ...r, tags: parseTags(r.tags) })),
    });

    res.json({
      provider: result.provider_used || availability.provider || config.primaryProvider,
      provider_used: result.provider_used || availability.provider || config.primaryProvider,
      fallback_used: !!result.fallback_used,
      model: result.model_used || config.model,
      requested_count: ids.length,
      analyzed_count: eligible.length,
      skipped: { missing: missingCount, categorized: categorizedSkipped },
      privacy: result.privacy || { amount_shared: true },
      attempts: result.attempts || [],
      suggestions: result.suggestions || [],
    });
  } catch (err) {
    console.error('AI transaction suggestion failed:', err);
    const status = err?.code === 'SQLITE_BUSY'
      ? 503
      : (err?.name === 'OllamaError' || err?.name === 'GeminiError' ? 502 : 500);
    res.status(status).json({
      code: 'AI_REQUEST_FAILED',
      error: err?.message || 'Failed to generate AI suggestions',
      attempts: Array.isArray(err?.attempts) ? err.attempts : undefined,
    });
  }
});

router.post('/rules/suggest', (req, res) => {
  res.status(501).json({
    error: 'Rule suggestion scaffolding is not implemented yet.',
    next_step: 'Implement rule proposal generation and preview-only flow.',
  });
});

module.exports = router;
