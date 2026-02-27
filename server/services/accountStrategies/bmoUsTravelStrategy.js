const STRATEGY_SOURCE = 'account_strategy_bmo_us_v1';

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPaymentLike(description) {
  const d = normalize(description);
  if (!d) return false;
  const transferHints = [
    'PAYMENT RECEIVED',
    'CARD PAYMENT',
    'C C PAYMENT',
    'THANK YOU',
    'AUTOPAY',
    'AUTO PAY',
    'TRANSFER',
    'TRSF',
    'XFER',
    'TRSFFROM DEACCT CPT',
    'TRSF FROM DE ACCT CPT',
  ];
  return transferHints.some((hint) => d.includes(hint));
}

function isTransferLike(row) {
  const amount = Number(row.amount || 0);
  if (!(amount > 0)) return false;
  return isPaymentLike(row.description);
}

function resolveTravelCategoryId(row, refs) {
  return refs.travelUsdCategoryId ?? refs.travelCategoryId ?? row.category_id ?? null;
}

function resolveCcPaymentCategoryId(row, refs) {
  return refs.ccPaymentCategoryId ?? resolveTravelCategoryId(row, refs);
}

function applyBmoUsTravelStrategy(row, refs = {}) {
  const transferLike = isTransferLike(row);

  if (transferLike) {
    return {
      ...row,
      category_id: resolveCcPaymentCategoryId(row, refs),
      tags: [],
      is_transfer: 1,
      exclude_from_totals: 1,
      category_source: STRATEGY_SOURCE,
      category_locked: 1,
      tags_locked: 1,
      strategy_case: 'transfer_payment',
    };
  }

  return {
    ...row,
    category_id: resolveTravelCategoryId(row, refs),
    tags: [],
    is_transfer: 0,
    exclude_from_totals: 0,
    category_source: STRATEGY_SOURCE,
    category_locked: 1,
    tags_locked: 1,
    strategy_case: 'travel_us_umbrella',
  };
}

module.exports = {
  STRATEGY_SOURCE,
  applyBmoUsTravelStrategy,
};
