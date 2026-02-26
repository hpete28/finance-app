const { generateTransactionSuggestions } = require('./orchestrator');

function clampConfidence(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function sanitizeTag(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 32);
  if (!cleaned) return null;
  return cleaned;
}

function sanitizeMerchantName(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return cleaned || null;
}

function sanitizeReason(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}

function isStrongHistoryHint(hint) {
  return !!hint
    && Number(hint.support_count || 0) >= 2
    && Number(hint.support_ratio || 0) >= 0.75;
}

function normalizeModelOutput(raw, { categoryByName, txById, historicalHints = new Map(), minCategoryConfidence = 0.72 }) {
  const base = Array.isArray(raw) ? raw : raw?.suggestions;
  if (!Array.isArray(base)) return [];

  const normalized = [];
  const seen = new Set();

  for (const item of base) {
    const transactionId = String(item?.transaction_id || item?.id || '').trim();
    if (!transactionId || !txById.has(transactionId) || seen.has(transactionId)) continue;
    seen.add(transactionId);

    const rawCategory = String(
      item?.category_name || item?.suggested_category || item?.category || ''
    ).trim();
    const llmCategory = rawCategory ? categoryByName.get(rawCategory.toLowerCase()) : null;

    const tagSource = Array.isArray(item?.tags)
      ? item.tags
      : (Array.isArray(item?.suggested_tags) ? item.suggested_tags : []);
    const tags = [...new Set(tagSource.map(sanitizeTag).filter(Boolean))].slice(0, 3);

    const merchant = sanitizeMerchantName(
      item?.merchant_name ?? item?.normalized_merchant_name ?? item?.suggested_merchant_name
    );
    let confidence = clampConfidence(item?.confidence, llmCategory ? 0.7 : 0.4);
    let categoryEntry = llmCategory;
    let categorySource = llmCategory ? 'llm' : null;

    const hint = historicalHints.get(transactionId);
    const strongHistory = isStrongHistoryHint(hint);

    const reasonParts = [];
    const baseReason = sanitizeReason(item?.reason || item?.why || '');
    if (baseReason) reasonParts.push(baseReason);

    if (strongHistory) {
      const llmMissingOrWeak = !categoryEntry || confidence < minCategoryConfidence;
      const llmConflictsWithHistory = categoryEntry && Number(categoryEntry.id) !== Number(hint.category_id);

      if (llmMissingOrWeak || llmConflictsWithHistory) {
        categoryEntry = {
          id: hint.category_id,
          name: hint.category_name,
        };
        categorySource = 'history';
        confidence = Math.max(
          confidence,
          Math.min(0.97, 0.55 + Number(hint.support_ratio || 0) * 0.35)
        );
        reasonParts.push(`Matched ${hint.support_count}/${hint.total_count} similar past transactions`);
      }
    }

    if (categorySource === 'llm' && categoryEntry && confidence < minCategoryConfidence) {
      categoryEntry = null;
      categorySource = null;
      reasonParts.push('Category withheld due to low confidence');
    }

    const reason = sanitizeReason(reasonParts.join(' · '));

    normalized.push({
      transaction_id: transactionId,
      suggested_category_id: categoryEntry ? categoryEntry.id : null,
      suggested_category_name: categoryEntry ? categoryEntry.name : null,
      category_source: categorySource,
      suggested_tags: tags,
      suggested_merchant_name: merchant,
      confidence,
      reason,
      appliable: !!(categoryEntry || tags.length || merchant),
    });
  }

  return normalized;
}

async function suggestTransactionUpdates({ config, categories, transactions, historicalHints }) {
  const categoryByName = new Map(categories.map((c) => [String(c.name || '').toLowerCase(), c]));
  const txById = new Map(transactions.map((tx) => [String(tx.id), tx]));

  const providerResult = await generateTransactionSuggestions({
    config,
    categories,
    transactions,
  });

  const suggestions = normalizeModelOutput(providerResult.raw, {
    categoryByName,
    txById,
    historicalHints,
    minCategoryConfidence: Number(config?.minCategoryConfidence ?? 0.72),
  });

  return {
    suggestions,
    provider_used: providerResult.provider_used || providerResult.provider || null,
    fallback_used: !!providerResult.fallback_used,
    model_used: providerResult.model || null,
    attempts: providerResult.attempts || [],
    privacy: providerResult.privacy || { amount_shared: true },
  };
}

module.exports = { suggestTransactionUpdates };
