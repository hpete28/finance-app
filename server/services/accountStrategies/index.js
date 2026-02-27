const { STRATEGY_SOURCE, applyBmoUsTravelStrategy } = require('./bmoUsTravelStrategy');

const BMO_US_ACCOUNT_NAME = 'BMO US Credit Card';
const BMO_US_ACCOUNT_ID = 2;

function isBmoUsAccount({ accountId, accountName }) {
  const id = Number(accountId);
  return id === BMO_US_ACCOUNT_ID || String(accountName || '').trim() === BMO_US_ACCOUNT_NAME;
}

function getCategoryRefs(db) {
  const rows = db.prepare(`
    SELECT id, name
    FROM categories
    WHERE LOWER(name) IN ('travel', 'travel - $us', 'travel - us$', 'cc payment', 'bank fees')
  `).all();
  const byName = new Map(rows.map((r) => [String(r.name || '').toLowerCase(), Number(r.id)]));
  return {
    travelCategoryId: byName.get('travel') || null,
    travelUsdCategoryId: byName.get('travel - $us') || byName.get('travel - us$') || null,
    ccPaymentCategoryId: byName.get('cc payment') || null,
    bankFeesCategoryId: byName.get('bank fees') || null,
  };
}

function applyAccountStrategyToEvaluated({ db, accountId, accountName, evaluated }) {
  if (!isBmoUsAccount({ accountId, accountName })) return { ...evaluated };
  const refs = getCategoryRefs(db);
  return applyBmoUsTravelStrategy(evaluated, refs);
}

function applyAccountStrategyToRow({ db, row }) {
  if (!isBmoUsAccount({ accountId: row.account_id })) return { ...row };
  const refs = getCategoryRefs(db);
  return applyBmoUsTravelStrategy(row, refs);
}

module.exports = {
  STRATEGY_SOURCE,
  BMO_US_ACCOUNT_NAME,
  BMO_US_ACCOUNT_ID,
  isBmoUsAccount,
  getCategoryRefs,
  applyAccountStrategyToEvaluated,
  applyAccountStrategyToRow,
};
