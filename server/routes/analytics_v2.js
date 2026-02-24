// server/routes/analytics_v2.js
// New analytics endpoints — mount in server/index.js as:
//   app.use('/api/analytics', require('./routes/analytics_v2'));
// (Place BEFORE the existing analytics router so these routes win on exact match,
//  or merge these handlers into analytics.js)

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// ─── Helper: income flag builder (copy from analytics.js) ────────────────────
function getIncomeFlag(db) {
  const sources = db.prepare(`SELECT keyword, match_type FROM income_sources`).all();
  if (!sources.length) return `(t.is_income_override = 1 OR cat.is_income = 1)`;
  const conditions = sources.map(s => {
    const kw = s.keyword.replace(/'/g, "''");
    return s.match_type === 'exact'
      ? `UPPER(t.description) = UPPER('${kw}')`
      : `UPPER(t.description) LIKE UPPER('%${kw}%')`;
  });
  return `(t.is_income_override = 1 OR cat.is_income = 1 OR ${conditions.join(' OR ')})`;
}

// ─── Helper: percent change ───────────────────────────────────────────────────
function pctChange(prev, curr) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/rolling-trends
// Returns monthly totals for last N months with MoM and YoY deltas
// Query: ?months=18&account_id=&category_id=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rolling-trends', (req, res) => {
  try {
    const db = getDb();
    const months = Math.min(parseInt(req.query.months || 24), 60);
    const account_id = req.query.account_id;
    const incomeFlag = getIncomeFlag(db);

    let where = ['t.exclude_from_totals = 0'];
    let params = [];
    if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m', t.date) as month,
        SUM(CASE WHEN t.amount > 0 AND ${incomeFlag} THEN t.amount ELSE 0 END) as income,
        SUM(CASE WHEN t.amount < 0 AND (cat.is_income IS NULL OR cat.is_income = 0)
                 THEN ABS(t.amount) ELSE 0 END) as expenses
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY month
      ORDER BY month DESC
      LIMIT ?
    `).all(...params, months + 12); // fetch extra for YoY

    // Build lookup
    const byMonth = {};
    rows.forEach(r => { byMonth[r.month] = r; });

    // Only return last `months` months, enriched with deltas
    const sorted = rows.slice().reverse();
    const result = sorted.slice(Math.max(0, sorted.length - months)).map((r, i, arr) => {
      const prev = arr[i - 1];
      // YoY: same month last year
      const [yr, mo] = r.month.split('-');
      const yoyKey = `${parseInt(yr) - 1}-${mo}`;
      const yoyRow = byMonth[yoyKey];

      return {
        month: r.month,
        income: r.income,
        expenses: r.expenses,
        net: r.income - r.expenses,
        mom_expenses: prev ? pctChange(prev.expenses, r.expenses) : null,
        mom_income:   prev ? pctChange(prev.income,   r.income)   : null,
        mom_net:      prev ? pctChange(prev.net,       r.net)      : null,
        yoy_expenses: yoyRow ? pctChange(yoyRow.expenses, r.expenses) : null,
        yoy_income:   yoyRow ? pctChange(yoyRow.income,   r.income)   : null,
      };
    });

    // Rolling 30/90-day window totals (from today)
    const now = new Date().toISOString().slice(0, 10);
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const d90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

    const windowQuery = db.prepare(`
      SELECT
        SUM(CASE WHEN t.amount < 0 AND date >= ? AND (cat.is_income IS NULL OR cat.is_income = 0)
                 THEN ABS(t.amount) ELSE 0 END) as r30_expenses,
        SUM(CASE WHEN t.amount < 0 AND date >= ? AND (cat.is_income IS NULL OR cat.is_income = 0)
                 THEN ABS(t.amount) ELSE 0 END) as r90_expenses,
        SUM(CASE WHEN t.amount > 0 AND date >= ? AND ${incomeFlag} THEN t.amount ELSE 0 END) as r30_income,
        SUM(CASE WHEN t.amount > 0 AND date >= ? AND ${incomeFlag} THEN t.amount ELSE 0 END) as r90_income
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE t.exclude_from_totals = 0 ${account_id ? 'AND t.account_id = ?' : ''}
    `);

    const windowParams = account_id
      ? [d30, d90, d30, d90, account_id]
      : [d30, d90, d30, d90];
    const windows = windowQuery.get(...windowParams);

    res.json({ monthly: result, windows });
  } catch (err) {
    console.error('rolling-trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/merchant-concentration
// Returns top merchants by spend share + MoM trend
// Query: ?months=6&account_id=&limit=15
// ─────────────────────────────────────────────────────────────────────────────
router.get('/merchant-concentration', (req, res) => {
  try {
    const db = getDb();
    const months = parseInt(req.query.months || 6);
    const limit  = parseInt(req.query.limit  || 15);
    const account_id = req.query.account_id;

    // Start date = N months ago
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const start = startDate.toISOString().slice(0, 10);

    let where = ['t.exclude_from_totals = 0', 't.amount < 0', `t.date >= '${start}'`,
                 '(cat.is_income IS NULL OR cat.is_income = 0)'];
    let params = [];
    if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

    const merchantExpr = "COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.description)";

    const merchants = db.prepare(`
      SELECT
        ${merchantExpr} as merchant,
        COUNT(*) as tx_count,
        SUM(ABS(t.amount)) as total,
        MIN(t.date) as first_seen,
        MAX(t.date) as last_seen,
        strftime('%Y-%m', MAX(t.date)) as last_month,
        strftime('%Y-%m', MIN(t.date)) as first_month
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY ${merchantExpr}
      ORDER BY total DESC
      LIMIT ?
    `).all(...params, limit);

    // Total spend in window for share calculation
    const totalRow = db.prepare(`
      SELECT SUM(ABS(t.amount)) as grand_total
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE ${where.join(' AND ')}
    `).get(...params);

    const grandTotal = totalRow?.grand_total || 1;

    // Month-by-month for top 5 merchants (trend sparkline data)
    const top5 = merchants.slice(0, 5).map(m => m.merchant);
    const sparklines = {};

    if (top5.length > 0) {
      for (const merchant of top5) {
        const mParams = account_id
          ? [start, merchant.replace(/'/g, "''"), account_id]
          : [start, merchant.replace(/'/g, "''")];

        const mRows = db.prepare(`
          SELECT strftime('%Y-%m', t.date) as month, SUM(ABS(t.amount)) as total
          FROM transactions t
          WHERE t.exclude_from_totals = 0
            AND t.amount < 0
            AND t.date >= ?
            AND COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.description) = ?
            ${account_id ? 'AND t.account_id = ?' : ''}
          GROUP BY month
          ORDER BY month ASC
        `).all(...mParams);

        sparklines[merchant] = mRows;
      }
    }

    res.json({
      merchants: merchants.map(m => ({
        ...m,
        share_pct: (m.total / grandTotal) * 100,
        avg_tx: m.total / m.tx_count,
        sparkline: sparklines[m.merchant] || [],
      })),
      grand_total: grandTotal,
      window_months: months,
    });
  } catch (err) {
    console.error('merchant-concentration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/subscription-creep
// Detect recurring patterns and flag cost increases
// Query: ?account_id=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subscription-creep', (req, res) => {
  try {
    const db = getDb();
    const account_id = req.query.account_id;

    // Pull from recurring_patterns table if populated, else detect on the fly
    let patterns = db.prepare(`SELECT * FROM recurring_patterns ORDER BY avg_amount DESC`).all();

    if (!patterns.length) {
      // Fallback: find merchants with ≥3 transactions, std dev < 15% of mean (stable amount)
      // appearing ≥ monthly
      let where = ['t.exclude_from_totals = 0', 't.amount < 0'];
      let params = [];
      if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

      const merchantExpr = "COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.description)";

      patterns = db.prepare(`
        SELECT
          ${merchantExpr} as merchant,
          COUNT(*) as tx_count,
          AVG(ABS(t.amount)) as avg_amount,
          MIN(ABS(t.amount)) as min_amount,
          MAX(ABS(t.amount)) as max_amount,
          MIN(t.date) as first_date,
          MAX(t.date) as last_date
        FROM transactions t
        WHERE ${where.join(' AND ')}
        GROUP BY ${merchantExpr}
        HAVING
          tx_count >= 3
          AND (MAX(ABS(t.amount)) - MIN(ABS(t.amount))) / AVG(ABS(t.amount)) < 0.3
          AND (julianday(MAX(t.date)) - julianday(MIN(t.date))) / tx_count <= 40
        ORDER BY avg_amount DESC
        LIMIT 50
      `).all(...params);
    }

    // For each pattern, compute month-by-month to detect creep
    const enriched = patterns.map(p => {
      const merchantName = p.description_pattern || p.merchant || p.description || '';
      const safeName = merchantName.replace(/'/g, "''");

      const monthly = db.prepare(`
        SELECT strftime('%Y-%m', date) as month, ABS(amount) as amount
        FROM transactions
        WHERE exclude_from_totals = 0
          AND COALESCE(NULLIF(TRIM(merchant_name), ''), description) = ?
        ORDER BY month ASC
      `).all(merchantName);

      // Detect price creep: compare first 3 vs last 3 amounts
      const amounts = monthly.map(m => m.amount).filter(Boolean);
      const firstAvg = amounts.slice(0, 3).reduce((s,v)=>s+v,0) / Math.min(3, amounts.length);
      const lastAvg  = amounts.slice(-3).reduce((s,v)=>s+v,0) / Math.min(3, amounts.length);
      const creep_pct = pctChange(firstAvg, lastAvg);

      return {
        merchant: merchantName,
        avg_amount: p.avg_amount,
        min_amount: p.min_amount,
        max_amount: p.max_amount,
        tx_count: p.tx_count,
        first_date: p.first_date,
        last_date: p.last_date,
        monthly: monthly.slice(-12),
        creep_pct,
        is_creeping: creep_pct != null && creep_pct > 5,
        annual_estimate: (p.avg_amount || 0) * 12,
      };
    });

    const totalAnnual = enriched.reduce((s, p) => s + p.annual_estimate, 0);
    const creeping = enriched.filter(p => p.is_creeping);

    res.json({
      subscriptions: enriched,
      total_annual: totalAnnual,
      creeping_count: creeping.length,
      creeping,
    });
  } catch (err) {
    console.error('subscription-creep error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/income-volatility
// Month-by-month income with std dev, CV, pay-cycle detection
// Query: ?months=12&account_id=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/income-volatility', (req, res) => {
  try {
    const db = getDb();
    const months = parseInt(req.query.months || 12);
    const account_id = req.query.account_id;
    const incomeFlag = getIncomeFlag(db);

    let where = ['t.exclude_from_totals = 0', `t.amount > 0`];
    let params = [];
    if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

    const monthly = db.prepare(`
      SELECT
        strftime('%Y-%m', t.date) as month,
        SUM(CASE WHEN ${incomeFlag} THEN t.amount ELSE 0 END) as income,
        COUNT(CASE WHEN ${incomeFlag} THEN 1 END) as income_count
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY month
      ORDER BY month DESC
      LIMIT ?
    `).all(...params, months);

    const incomeAmounts = monthly.map(m => m.income).filter(v => v > 0);
    const n = incomeAmounts.length;
    const avg = n ? incomeAmounts.reduce((s,v)=>s+v,0)/n : 0;
    const variance = n > 1
      ? incomeAmounts.reduce((s,v)=>s+(v-avg)**2,0)/(n-1)
      : 0;
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? (stdDev / avg) * 100 : 0;

    // Pay-cycle detection: look at day-of-month distribution of income transactions
    let payCycleWhere = ['t.exclude_from_totals = 0', 't.amount > 0'];
    let payCycleParams = [];
    if (account_id) { payCycleWhere.push('t.account_id = ?'); payCycleParams.push(account_id); }

    const dayDist = db.prepare(`
      SELECT
        CAST(strftime('%d', t.date) AS INTEGER) as day_of_month,
        COUNT(*) as count,
        SUM(t.amount) as total
      FROM transactions t
      LEFT JOIN categories cat ON cat.id = t.category_id
      WHERE ${payCycleWhere.join(' AND ')} AND (${incomeFlag})
      GROUP BY day_of_month
      ORDER BY total DESC
    `).all(...payCycleParams);

    // Detect peaks (days with > 1.5x average frequency)
    const avgCount = dayDist.length ? dayDist.reduce((s,d)=>s+d.count,0)/dayDist.length : 0;
    const paydayPeaks = dayDist.filter(d => d.count > avgCount * 1.5).map(d => d.day_of_month).sort((a,b)=>a-b);

    res.json({
      monthly: monthly.reverse(),
      stats: { avg, std_dev: stdDev, cv_pct: cv, n_months: n },
      pay_cycle: {
        peaks: paydayPeaks,
        likely_biweekly: paydayPeaks.length >= 2,
        likely_monthly: paydayPeaks.length === 1,
        day_distribution: dayDist.slice(0, 10),
      },
      stability: cv < 10 ? 'stable' : cv < 25 ? 'moderate' : 'volatile',
    });
  } catch (err) {
    console.error('income-volatility error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/anomalies
// Flag transactions that are outliers vs historical baseline for that merchant/category
// Query: ?months=6&account_id=&threshold=2.5
// ─────────────────────────────────────────────────────────────────────────────
router.get('/anomalies', (req, res) => {
  try {
    const db = getDb();
    const months   = parseInt(req.query.months || 6);
    const zThresh  = parseFloat(req.query.threshold || 2.5);
    const account_id = req.query.account_id;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const start = startDate.toISOString().slice(0, 10);

    let where = ['t.exclude_from_totals = 0', 't.amount < 0', `t.date >= '${start}'`];
    let params = [];
    if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }

    const merchantExpr = "COALESCE(NULLIF(TRIM(t.merchant_name), ''), t.description)";

    // Get per-merchant stats
    const stats = db.prepare(`
      SELECT
        ${merchantExpr} as merchant,
        AVG(ABS(t.amount)) as mean_amount,
        COUNT(*) as count,
        -- SQLite doesn't have STDEV, compute manually via variance approach:
        AVG(ABS(t.amount) * ABS(t.amount)) - AVG(ABS(t.amount)) * AVG(ABS(t.amount)) as variance
      FROM transactions t
      WHERE ${where.join(' AND ')}
      GROUP BY ${merchantExpr}
      HAVING count >= 3
    `).all(...params);

    const statsMap = {};
    stats.forEach(s => {
      statsMap[s.merchant] = {
        mean: s.mean_amount,
        std: Math.sqrt(Math.max(0, s.variance)),
        count: s.count,
      };
    });

    // Get recent transactions (last 2 months) and flag outliers
    const recentStart = new Date();
    recentStart.setMonth(recentStart.getMonth() - 2);
    const recentStartStr = recentStart.toISOString().slice(0, 10);

    let recentWhere = [...where, `t.date >= '${recentStartStr}'`];

    const recent = db.prepare(`
      SELECT
        t.id, t.date, t.description, t.amount, t.category_id,
        ${merchantExpr} as merchant,
        a.name as account_name,
        c.name as category_name, c.color as category_color
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${recentWhere.join(' AND ')}
      ORDER BY t.date DESC
      LIMIT 1000
    `).all(...params);

    const anomalies = [];
    recent.forEach(tx => {
      const s = statsMap[tx.merchant];
      if (!s || s.std < 0.5) return; // too stable to flag, or no history

      const z = (Math.abs(tx.amount) - s.mean) / s.std;
      if (z >= zThresh) {
        anomalies.push({
          ...tx,
          z_score: z,
          expected_amount: s.mean,
          overage: Math.abs(tx.amount) - s.mean,
          overage_pct: pctChange(s.mean, Math.abs(tx.amount)),
          reason: `${z.toFixed(1)}σ above typical spend for ${tx.merchant}`,
        });
      }
    });

    // Also flag: unusual category surge (top category this month vs rolling avg)
    const thisMonth = new Date().toISOString().slice(0, 7);
    const catSurge = db.prepare(`
      WITH monthly_cat AS (
        SELECT
          t.category_id,
          c.name as category_name,
          strftime('%Y-%m', t.date) as month,
          SUM(ABS(t.amount)) as total
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.exclude_from_totals = 0 AND t.amount < 0
          ${account_id ? 'AND t.account_id = ?' : ''}
        GROUP BY t.category_id, month
      ),
      cat_avg AS (
        SELECT category_id, category_name,
               AVG(total) as avg_total,
               MAX(CASE WHEN month = ? THEN total END) as this_month
        FROM monthly_cat
        WHERE month < ?
        GROUP BY category_id
      )
      SELECT *,
        (this_month - avg_total) / avg_total * 100 as surge_pct
      FROM cat_avg
      WHERE this_month IS NOT NULL
        AND surge_pct > 40
        AND avg_total > 50
      ORDER BY surge_pct DESC
      LIMIT 10
    `).all(...(account_id ? [account_id, thisMonth, thisMonth] : [thisMonth, thisMonth]));

    anomalies.sort((a, b) => b.z_score - a.z_score);

    res.json({
      anomalies: anomalies.slice(0, 50),
      category_surges: catSurge,
      count: anomalies.length,
      parameters: { months, z_threshold: zThresh },
    });
  } catch (err) {
    console.error('anomalies error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/budget-variance-trend
// Per-category: budget vs actual for last N months
// Query: ?months=6
// ─────────────────────────────────────────────────────────────────────────────
router.get('/budget-variance-trend', (req, res) => {
  try {
    const db = getDb();
    const months = parseInt(req.query.months || 6);

    const budgets = db.prepare(`SELECT * FROM budgets`).all();
    if (!budgets.length) return res.json({ months: [], budgets: [] });

    const result = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const actuals = db.prepare(`
        SELECT t.category_id, SUM(ABS(t.amount)) as actual
        FROM transactions t
        WHERE t.exclude_from_totals = 0 AND t.amount < 0
          AND strftime('%Y-%m', t.date) = ?
        GROUP BY t.category_id
      `).all(month);

      const actualMap = {};
      actuals.forEach(a => { actualMap[a.category_id] = a.actual; });

      result.push({
        month,
        categories: budgets.map(b => ({
          category_id: b.category_id,
          category_name: b.category_name,
          budgeted: b.amount,
          actual: actualMap[b.category_id] || 0,
          variance: (actualMap[b.category_id] || 0) - b.amount,
          variance_pct: b.amount > 0
            ? (((actualMap[b.category_id] || 0) - b.amount) / b.amount) * 100
            : null,
        })),
      });
    }

    res.json({ months: result, budget_categories: budgets });
  } catch (err) {
    console.error('budget-variance-trend error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
