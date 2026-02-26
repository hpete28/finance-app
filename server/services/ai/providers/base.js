function buildModelTransactions(transactions, { includeAmount = false } = {}) {
  return transactions.map((tx) => {
    const base = {
      transaction_id: tx.id,
      date: tx.date,
      description: tx.description,
      account_name: tx.account_name,
      merchant_name: tx.merchant_name || null,
      tags: Array.isArray(tx.tags) ? tx.tags : [],
    };

    if (includeAmount) {
      base.amount = tx.amount;
      base.currency = tx.currency || null;
    }

    return base;
  });
}

function buildTransactionPrompt({ categories, modelTransactions, includeAmount = false }) {
  const categoryNames = categories.map((c) => c.name);
  const privacyLine = includeAmount
    ? 'Amounts are available in this request.'
    : 'Amounts are intentionally omitted for privacy. Do not infer exact amounts.';

  return [
    'You are a finance assistant for transaction cleanup.',
    'Return ONLY valid JSON. No markdown, no prose.',
    privacyLine,
    'For each transaction, suggest:',
    '- category_name: one of the allowed categories or null',
    '- tags: up to 3 short tags',
    '- merchant_name: normalized merchant name or null',
    '- confidence: number between 0 and 1',
    '- reason: one short reason',
    '',
    'Do not invent category names. Use null if unsure.',
    '',
    'Output schema:',
    '{"suggestions":[{"transaction_id":"...","category_name":"...|null","tags":["..."],"merchant_name":"...|null","confidence":0.0,"reason":"..."}]}',
    '',
    `Allowed categories: ${JSON.stringify(categoryNames)}`,
    `Transactions: ${JSON.stringify(modelTransactions)}`,
  ].join('\n');
}

function assertNoAmountFields(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertNoAmountFields(item, `${path}[${idx}]`));
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (/amount/i.test(key)) {
      throw new Error(`Cloud payload contains forbidden amount-like field: ${path}.${key}`);
    }
    assertNoAmountFields(child, `${path}.${key}`);
  }
}

function parseLooseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(fenced);
    } catch {
      const match = fenced.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
}

module.exports = {
  buildModelTransactions,
  buildTransactionPrompt,
  assertNoAmountFields,
  parseLooseJson,
};
