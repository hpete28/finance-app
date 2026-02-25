const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toDayNumber(dateStr) {
  const ts = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ts) ? Math.floor(ts / MS_PER_DAY) : null;
}

function dayDiff(a, b) {
  const da = toDayNumber(a);
  const db = toDayNumber(b);
  if (da == null || db == null) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db);
}

function hasTransferHint(description) {
  return /(PAYMENT|THANK YOU|TFR|TRANSFER|E-TRANSFER|BMO MC|C\/C|CARD PAYMENT)/i.test(String(description || ''));
}

function scorePair(debit, credit, daysWindow) {
  if (!debit || !credit) return null;
  if (debit.account_id === credit.account_id) return null;

  const absDiff = Math.abs(Math.abs(debit.amount) - Math.abs(credit.amount));
  if (absDiff > 0.01) return null;

  const days = dayDiff(debit.date, credit.date);
  if (days > daysWindow) return null;

  let confidence = 0.3;
  const reasons = ['same amount'];

  if (days === 0) {
    confidence += 0.25;
    reasons.push('same day');
  } else if (days === 1) {
    confidence += 0.16;
    reasons.push('1 day apart');
  } else {
    confidence += 0.08;
    reasons.push(`within ${days} days`);
  }

  if (['checking', 'savings'].includes(debit.account_type)) {
    confidence += 0.1;
    reasons.push('source looks like cash account');
  }

  if (['credit_card', 'liability'].includes(credit.account_type)) {
    confidence += 0.15;
    reasons.push('destination looks like liability account');
  }

  const debitHint = hasTransferHint(debit.description);
  const creditHint = hasTransferHint(credit.description);
  if (debitHint && creditHint) {
    confidence += 0.18;
    reasons.push('both descriptions look transfer-like');
  } else if (debitHint || creditHint) {
    confidence += 0.1;
    reasons.push('one description looks transfer-like');
  }

  if (/(PAYMENT|THANK YOU|CARD PAYMENT|C\/C)/i.test(String(credit.description || ''))) {
    confidence += 0.06;
    reasons.push('credit side looks like card payment');
  }
  if (/(TFR|TRANSFER|E-TRANSFER|BMO MC|C\/C)/i.test(String(debit.description || ''))) {
    confidence += 0.06;
    reasons.push('debit side looks like transfer');
  }

  return {
    confidence: clamp(confidence, 0, 0.99),
    reasons,
    day_diff: days,
  };
}

function byDateThenId(a, b) {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return String(a.id).localeCompare(String(b.id));
}

function detectTransferCandidates(db, options = {}) {
  const daysWindow = clamp(parseInt(options.daysWindow || options.days_window || 3, 10) || 3, 0, 7);
  const limit = clamp(parseInt(options.limit || 150, 10) || 150, 1, 500);
  const minConfidence = clamp(Number(options.minConfidence ?? options.min_confidence ?? 0.55), 0, 1);
  const startDate = options.startDate || options.start_date || null;
  const endDate = options.endDate || options.end_date || null;

  const where = ['t.is_transfer = 0', 't.exclude_from_totals = 0'];
  const params = [];
  if (startDate) { where.push('t.date >= ?'); params.push(startDate); }
  if (endDate) { where.push('t.date <= ?'); params.push(endDate); }

  const rows = db.prepare(`
    SELECT
      t.id, t.date, t.description, t.amount, t.account_id,
      a.name as account_name, a.type as account_type
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.date ASC, t.id ASC
  `).all(...params);

  const debits = rows.filter((r) => r.amount < 0).sort(byDateThenId);
  const credits = rows.filter((r) => r.amount > 0).sort(byDateThenId);

  const creditsByAmount = new Map();
  for (const tx of credits) {
    const key = Math.abs(tx.amount).toFixed(2);
    const list = creditsByAmount.get(key) || [];
    list.push(tx);
    creditsByAmount.set(key, list);
  }

  const usedCredits = new Set();
  const candidates = [];

  for (const debit of debits) {
    if (candidates.length >= limit) break;

    const amountKey = Math.abs(debit.amount).toFixed(2);
    const sameAmountCredits = creditsByAmount.get(amountKey) || [];
    let best = null;

    for (const credit of sameAmountCredits) {
      if (usedCredits.has(credit.id)) continue;
      const scored = scorePair(debit, credit, daysWindow);
      if (!scored || scored.confidence < minConfidence) continue;

      if (
        !best
        || scored.confidence > best.scored.confidence
        || (scored.confidence === best.scored.confidence && scored.day_diff < best.scored.day_diff)
        || (
          scored.confidence === best.scored.confidence
          && scored.day_diff === best.scored.day_diff
          && byDateThenId(credit, best.credit) < 0
        )
      ) {
        best = { credit, scored };
      }
    }

    if (!best) continue;
    usedCredits.add(best.credit.id);

    candidates.push({
      pair_id: `${debit.id}:${best.credit.id}`,
      confidence: Number(best.scored.confidence.toFixed(2)),
      day_diff: best.scored.day_diff,
      amount: Math.abs(debit.amount),
      reasons: best.scored.reasons,
      debit_tx_id: debit.id,
      credit_tx_id: best.credit.id,
      debit: {
        id: debit.id,
        date: debit.date,
        amount: debit.amount,
        description: debit.description,
        account_id: debit.account_id,
        account_name: debit.account_name,
        account_type: debit.account_type,
      },
      credit: {
        id: best.credit.id,
        date: best.credit.date,
        amount: best.credit.amount,
        description: best.credit.description,
        account_id: best.credit.account_id,
        account_name: best.credit.account_name,
        account_type: best.credit.account_type,
      },
    });
  }

  candidates.sort((a, b) =>
    b.confidence - a.confidence
    || a.day_diff - b.day_diff
    || (a.debit.date < b.debit.date ? 1 : a.debit.date > b.debit.date ? -1 : 0)
  );

  return {
    candidates,
    options: {
      start_date: startDate,
      end_date: endDate,
      days_window: daysWindow,
      limit,
      min_confidence: minConfidence,
    },
  };
}

module.exports = { detectTransferCandidates };
