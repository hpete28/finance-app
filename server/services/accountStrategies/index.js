const { STRATEGY_SOURCE, applyBmoUsTravelStrategy } = require('./bmoUsTravelStrategy');
const {
  STRATEGY_SOURCE: TD_RENTAL_STRATEGY_SOURCE,
  TD_CHECKING_ACCOUNT_ID,
  TD_CHECKING_ACCOUNT_NAME,
  applyTdCheckingRentalIncomeStrategy,
} = require('./tdCheckingRentalIncomeStrategy');

const BMO_US_ACCOUNT_NAME = 'BMO US Credit Card';
const BMO_US_ACCOUNT_ID = 2;

function isBmoUsAccount({ accountId, accountName }) {
  const id = Number(accountId);
  return id === BMO_US_ACCOUNT_ID || String(accountName || '').trim() === BMO_US_ACCOUNT_NAME;
}

function isTdCheckingAccount({ accountId, accountName }) {
  const id = Number(accountId);
  return id === TD_CHECKING_ACCOUNT_ID || String(accountName || '').trim() === TD_CHECKING_ACCOUNT_NAME;
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

function getIncomeCategoryId(db) {
  const row = db.prepare(`
    SELECT id
    FROM categories
    WHERE COALESCE(is_income, 0) = 1
    ORDER BY CASE WHEN LOWER(name) = 'income' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get();
  return row ? Number(row.id) : null;
}

function applyAccountStrategyToEvaluated({ db, accountId, accountName, evaluated }) {
  if (isBmoUsAccount({ accountId, accountName })) {
    const refs = getCategoryRefs(db);
    return applyBmoUsTravelStrategy(evaluated, refs);
  }
  if (isTdCheckingAccount({ accountId, accountName })) {
    return applyTdCheckingRentalIncomeStrategy(evaluated, {
      incomeCategoryId: getIncomeCategoryId(db),
    });
  }
  return { ...evaluated };
}

function applyAccountStrategyToRow({ db, row }) {
  if (isBmoUsAccount({ accountId: row.account_id })) {
    const refs = getCategoryRefs(db);
    return applyBmoUsTravelStrategy(row, refs);
  }
  if (isTdCheckingAccount({ accountId: row.account_id })) {
    return applyTdCheckingRentalIncomeStrategy(row, {
      incomeCategoryId: getIncomeCategoryId(db),
    });
  }
  return { ...row };
}

module.exports = {
  STRATEGY_SOURCE,
  TD_RENTAL_STRATEGY_SOURCE,
  BMO_US_ACCOUNT_NAME,
  BMO_US_ACCOUNT_ID,
  TD_CHECKING_ACCOUNT_NAME,
  TD_CHECKING_ACCOUNT_ID,
  isBmoUsAccount,
  isTdCheckingAccount,
  getCategoryRefs,
  getIncomeCategoryId,
  applyAccountStrategyToEvaluated,
  applyAccountStrategyToRow,
};
