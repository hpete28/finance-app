const STRATEGY_SOURCE = 'account_strategy_td_rental_v1';

const TD_CHECKING_ACCOUNT_NAME = 'TD CAD Checking';
const TD_CHECKING_ACCOUNT_ID = 4;

const PROPERTY_A_TAG = 'Property Rental-Cresthaven';
const PROPERTY_B_TAG = 'Property Rental-Woodruff';
const REVIEW_PROPERTY_B_TAG = 'review:rental_property_b_candidate';

const PROPERTY_A_TARGET = 2245;
const PROPERTY_A_TOLERANCE = 120;
const PROPERTY_B_TARGET = 3700;
const PROPERTY_B_TOLERANCE_STRONG = 120;
const PROPERTY_B_TOLERANCE_SOFT = 250;

const PROPERTY_A_DAY_MIN = 27;
const PROPERTY_A_DAY_MAX = 5;
const PROPERTY_B_DAY_START = 17;
const PROPERTY_B_DAY_END = 27;

const MIN_SPLIT_PART = 500;
const MAX_SPLIT_PART = 3300;
const MAX_SPLIT_PARTS = 3;

function parseTags(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v || '').trim()).filter(Boolean))];
  }
  if (typeof value === 'string') {
    try { return parseTags(JSON.parse(value)); } catch { return []; }
  }
  return [];
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEtransferLike(description) {
  const d = normalize(description);
  if (!d) return false;
  return d.includes('E TRANSFER') || d.includes('INTERAC');
}

function toDay(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Number(m[3]);
}

function isPropertyAWindow(dateStr) {
  const day = toDay(dateStr);
  if (!day) return false;
  return day >= PROPERTY_A_DAY_MIN || day <= PROPERTY_A_DAY_MAX;
}

function isPropertyBWindow(dateStr) {
  const day = toDay(dateStr);
  if (!day) return false;
  return day >= PROPERTY_B_DAY_START && day <= PROPERTY_B_DAY_END;
}

function absAmount(value) {
  return Math.abs(Number(value) || 0);
}

function approxEquals(value, target, tolerance) {
  return Math.abs(absAmount(value) - Math.abs(target)) <= tolerance;
}

function rentalMonthKey(dateStr, boundaryShiftDays = 0) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]);
  const day = Number(m[3]);
  if (boundaryShiftDays > 0 && day <= boundaryShiftDays) {
    month -= 1;
    if (month <= 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

function shiftDate(dateStr, days) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr || null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function canAutoMutate(row) {
  if (Number(row.reviewed || 0) === 1) return false;
  const locked = Number(row.category_locked || 0) === 1 || Number(row.tags_locked || 0) === 1;
  if (!locked) return true;
  return String(row.category_source || '') === STRATEGY_SOURCE;
}

function tagsForProperty(existingTags, propertyKey) {
  const cleaned = parseTags(existingTags).filter((tag) => {
    return ![
      'income:rental_property',
      'income:rental_property:cresthaven',
      'income:rental_property:woodroffe',
      'Property Rental - Cresthaven',
      'Property Rental - Woodroffe',
      'Property Rental-Cresthaven',
      'Property Rental-Woodroffe',
      'Property Rental-Woodruff',
      REVIEW_PROPERTY_B_TAG,
    ].includes(tag);
  });

  if (propertyKey === 'A') {
    return [...new Set([...cleaned, PROPERTY_A_TAG])];
  }
  if (propertyKey === 'B') {
    return [...new Set([...cleaned, PROPERTY_B_TAG])];
  }
  return cleaned;
}

function addReviewTag(existingTags) {
  return [...new Set([...parseTags(existingTags), REVIEW_PROPERTY_B_TAG])];
}

function buildClassifiedRow(row, { incomeCategoryId, propertyKey }) {
  if (!incomeCategoryId) return { ...row };
  return {
    ...row,
    category_id: incomeCategoryId,
    tags: tagsForProperty(row.tags, propertyKey),
    category_source: STRATEGY_SOURCE,
    category_locked: 1,
    tags_locked: 1,
  };
}

function isEligibleRentalCandidate(row) {
  return (
    Number(row.amount) > 0 &&
    Number(row.is_transfer || 0) === 0 &&
    Number(row.exclude_from_totals || 0) === 0 &&
    isEtransferLike(row.description)
  );
}

function findSplitCombos(rows, target, tolerance) {
  const out = [];
  const n = rows.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const sum2 = absAmount(rows[i].amount) + absAmount(rows[j].amount);
      if (Math.abs(sum2 - target) <= tolerance) {
        out.push([rows[i], rows[j]]);
      }
      if (MAX_SPLIT_PARTS < 3) continue;
      for (let k = j + 1; k < n; k += 1) {
        const sum3 = sum2 + absAmount(rows[k].amount);
        if (Math.abs(sum3 - target) <= tolerance) {
          out.push([rows[i], rows[j], rows[k]]);
        }
      }
    }
  }
  return out;
}

function applyTdCheckingRentalIncomeStrategy(row, refs = {}) {
  if (!isEligibleRentalCandidate(row)) return { ...row };
  if (!canAutoMutate(row)) return { ...row };
  if (!refs.incomeCategoryId) return { ...row };

  if (isPropertyAWindow(row.date) && approxEquals(row.amount, PROPERTY_A_TARGET, PROPERTY_A_TOLERANCE)) {
    return buildClassifiedRow(row, { incomeCategoryId: refs.incomeCategoryId, propertyKey: 'A' });
  }

  if (isPropertyBWindow(row.date) && approxEquals(row.amount, PROPERTY_B_TARGET, PROPERTY_B_TOLERANCE_STRONG)) {
    return buildClassifiedRow(row, { incomeCategoryId: refs.incomeCategoryId, propertyKey: 'B' });
  }

  return { ...row };
}

function updateTransactionRows(db, updates = []) {
  if (!updates.length) return 0;
  const updateTx = db.prepare(`
    UPDATE transactions
    SET category_id = ?,
        tags = ?,
        category_source = ?,
        category_locked = ?,
        tags_locked = ?
    WHERE id = ?
  `);
  let changed = 0;
  db.transaction(() => {
    for (const u of updates) {
      const info = updateTx.run(
        u.category_id ?? null,
        JSON.stringify(parseTags(u.tags)),
        u.category_source || 'import_default',
        u.category_locked ? 1 : 0,
        u.tags_locked ? 1 : 0,
        u.id
      );
      changed += Number(info.changes || 0);
    }
  })();
  return changed;
}

function backfillTdCheckingRentalIncome(db, {
  accountId = TD_CHECKING_ACCOUNT_ID,
  startDate = null,
  endDate = null,
  lookbackDays = 14,
  lookaheadDays = 14,
  dryRun = false,
} = {}) {
  const incomeRow = db.prepare(`
    SELECT id
    FROM categories
    WHERE COALESCE(is_income, 0) = 1
    ORDER BY CASE WHEN LOWER(name) = 'income' THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get();
  const incomeCategoryId = incomeRow ? Number(incomeRow.id) : null;
  if (!incomeCategoryId) {
    return {
      scanned: 0,
      updated: 0,
      property_a_assigned: 0,
      property_b_assigned: 0,
      review_tagged: 0,
      reason: 'missing_income_category',
    };
  }

  const where = ['account_id = ?', 'amount > 0'];
  const params = [Number(accountId)];
  const effectiveStartDate = startDate ? shiftDate(startDate, -Math.abs(Number(lookbackDays || 0))) : null;
  const effectiveEndDate = endDate ? shiftDate(endDate, Math.abs(Number(lookaheadDays || 0))) : null;

  if (effectiveStartDate) {
    where.push('date >= ?');
    params.push(effectiveStartDate);
  }
  if (effectiveEndDate) {
    where.push('date <= ?');
    params.push(effectiveEndDate);
  }

  const rows = db.prepare(`
    SELECT id, account_id, date, description, amount, category_id, tags, reviewed,
           is_transfer, exclude_from_totals, category_source, category_locked, tags_locked
    FROM transactions
    WHERE ${where.join(' AND ')}
    ORDER BY date ASC, created_at ASC
  `).all(...params).map((r) => ({ ...r, tags: parseTags(r.tags) }));

  const candidates = rows.filter((r) => isEligibleRentalCandidate(r));
  const byMonthA = new Map();
  const byMonthB = new Map();
  for (const row of candidates) {
    const keyA = rentalMonthKey(row.date, PROPERTY_A_DAY_MAX);
    const keyB = rentalMonthKey(row.date, 0);
    if (isPropertyAWindow(row.date) && approxEquals(row.amount, PROPERTY_A_TARGET, PROPERTY_A_TOLERANCE)) {
      const listA = byMonthA.get(keyA) || [];
      listA.push(row);
      byMonthA.set(keyA, listA);
    }
    if (isPropertyBWindow(row.date) && absAmount(row.amount) >= MIN_SPLIT_PART && absAmount(row.amount) <= MAX_SPLIT_PART) {
      const listB = byMonthB.get(keyB) || [];
      listB.push(row);
      byMonthB.set(keyB, listB);
    }
  }

  const updatesById = new Map();
  const propertyAIds = new Set();
  const propertyBIds = new Set();
  const reviewIds = new Set();

  for (const monthRows of byMonthA.values()) {
    const mutableA = monthRows.filter(canAutoMutate);
    if (mutableA.length) {
      mutableA.sort((a, b) => {
        const diff = Math.abs(absAmount(a.amount) - PROPERTY_A_TARGET) - Math.abs(absAmount(b.amount) - PROPERTY_A_TARGET);
        if (diff !== 0) return diff;
        return String(a.date).localeCompare(String(b.date));
      });
      const winner = mutableA[0];
      const next = buildClassifiedRow(winner, { incomeCategoryId, propertyKey: 'A' });
      updatesById.set(winner.id, next);
      propertyAIds.add(winner.id);
    }
  }

  for (const monthRows of byMonthB.values()) {
    const alreadyAssigned = new Set([...updatesById.keys()]);
    const mutableB = monthRows.filter((r) => canAutoMutate(r) && !alreadyAssigned.has(r.id));

    if (!mutableB.length) continue;

    const strongSingles = mutableB.filter((r) => approxEquals(r.amount, PROPERTY_B_TARGET, PROPERTY_B_TOLERANCE_STRONG));
    if (strongSingles.length === 1) {
      const only = strongSingles[0];
      const next = buildClassifiedRow(only, { incomeCategoryId, propertyKey: 'B' });
      updatesById.set(only.id, next);
      propertyBIds.add(only.id);
      continue;
    }
    if (strongSingles.length > 1) {
      for (const row of strongSingles) {
        updatesById.set(row.id, { ...row, tags: addReviewTag(row.tags) });
        reviewIds.add(row.id);
      }
      continue;
    }

    const strongCombos = findSplitCombos(mutableB, PROPERTY_B_TARGET, PROPERTY_B_TOLERANCE_STRONG);
    if (strongCombos.length === 1) {
      for (const row of strongCombos[0]) {
        const next = buildClassifiedRow(row, { incomeCategoryId, propertyKey: 'B' });
        updatesById.set(row.id, next);
        propertyBIds.add(row.id);
      }
      continue;
    }

    const softCombos = findSplitCombos(mutableB, PROPERTY_B_TARGET, PROPERTY_B_TOLERANCE_SOFT);
    if (strongCombos.length > 1 || softCombos.length > 0) {
      for (const row of mutableB) {
        updatesById.set(row.id, { ...row, tags: addReviewTag(row.tags) });
        reviewIds.add(row.id);
      }
    }
  }

  const updates = [...updatesById.values()];
  const updated = dryRun ? updates.length : updateTransactionRows(db, updates);

  return {
    scanned: rows.length,
    updated,
    property_a_assigned: propertyAIds.size,
    property_b_assigned: propertyBIds.size,
    review_tagged: reviewIds.size,
    account_id: Number(accountId),
    category_id: incomeCategoryId,
    start_date: effectiveStartDate || null,
    end_date: effectiveEndDate || null,
    dry_run: !!dryRun,
  };
}

module.exports = {
  STRATEGY_SOURCE,
  TD_CHECKING_ACCOUNT_NAME,
  TD_CHECKING_ACCOUNT_ID,
  applyTdCheckingRentalIncomeStrategy,
  backfillTdCheckingRentalIncome,
};
