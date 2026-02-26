const {
  buildModelTransactions,
  buildTransactionPrompt,
  assertNoAmountFields,
} = require('./providers/base');
const ollamaProvider = require('./providers/ollamaProvider');
const geminiProvider = require('./providers/geminiProvider');

const PROVIDERS = {
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

function asProviderName(value, fallback = 'ollama') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gemini' || normalized === 'ollama') return normalized;
  return fallback;
}

function getProviderOrder(config) {
  const primary = asProviderName(config.primaryProvider, 'gemini');
  const fallback = asProviderName(config.fallbackProvider, 'ollama');
  return [...new Set([primary, fallback])];
}

function getProviderConfig(config, name) {
  return config?.providers?.[name] || {};
}

function buildStatusError(order, providers) {
  return `No AI providers available. Tried: ${order.map((name) => `${name}(${providers[name]?.error || 'unavailable'})`).join(', ')}`;
}

async function getAiStatus(config) {
  const checkedAt = new Date().toISOString();
  const order = getProviderOrder(config);
  const providerStatuses = {};

  if (!config.enabled) {
    providerStatuses.gemini = {
      name: 'gemini',
      configured: !!getProviderConfig(config, 'gemini')?.apiKey,
      available: false,
      reachable: false,
      model: getProviderConfig(config, 'gemini')?.model || null,
      error: 'AI disabled',
    };
    providerStatuses.ollama = {
      name: 'ollama',
      configured: !!(getProviderConfig(config, 'ollama')?.baseUrl && getProviderConfig(config, 'ollama')?.model),
      available: false,
      reachable: false,
      model: getProviderConfig(config, 'ollama')?.model || null,
      base_url: getProviderConfig(config, 'ollama')?.baseUrl || null,
      error: 'AI disabled',
    };

    return {
      enabled: false,
      available: false,
      provider: 'multi',
      primary_provider: order[0],
      fallback_provider: order[1] || null,
      providers: providerStatuses,
      privacy_mode: {
        share_amount: !!config.shareAmount,
        text_fields: ['merchant_name', 'description'],
      },
      error: 'AI features are disabled by AI_FEATURES_ENABLED',
      checked_at: checkedAt,
    };
  }

  for (const name of Object.keys(PROVIDERS)) {
    const provider = PROVIDERS[name];
    try {
      providerStatuses[name] = await provider.getStatus(getProviderConfig(config, name));
    } catch (err) {
      providerStatuses[name] = {
        name,
        configured: false,
        available: false,
        model: getProviderConfig(config, name)?.model || null,
        error: err?.message || 'Status check failed',
      };
    }
  }

  const primary = providerStatuses[order[0]];
  const fallback = providerStatuses[order[1]] || null;
  const available = !!(primary?.available || fallback?.available);

  const chosen = primary?.available ? primary : (fallback?.available ? fallback : primary || fallback || null);
  return {
    enabled: true,
    available,
    provider: chosen?.name || order[0],
    primary_provider: order[0],
    fallback_provider: order[1] || null,
    providers: providerStatuses,
    model: chosen?.model || null,
    base_url: chosen?.base_url || null,
    privacy_mode: {
      share_amount: !!config.shareAmount,
      text_fields: ['merchant_name', 'description'],
    },
    error: available ? null : buildStatusError(order, providerStatuses),
    checked_at: checkedAt,
  };
}

async function generateTransactionSuggestions({ config, categories, transactions }) {
  const order = getProviderOrder(config);
  const attempts = [];
  let lastErr = null;

  for (let idx = 0; idx < order.length; idx++) {
    const name = order[idx];
    const provider = PROVIDERS[name];
    if (!provider) continue;
    const providerConfig = getProviderConfig(config, name);

    try {
      const includeAmount = provider.isCloud ? !!config.shareAmount : true;
      const modelTransactions = buildModelTransactions(transactions, { includeAmount });
      if (provider.isCloud && !config.shareAmount) {
        assertNoAmountFields(modelTransactions);
      }

      const prompt = buildTransactionPrompt({
        categories,
        modelTransactions,
        includeAmount,
      });

      const result = await provider.generateTransactionSuggestions({
        providerConfig,
        prompt,
      });

      return {
        ...result,
        provider_used: name,
        fallback_used: idx > 0,
        attempts,
        privacy: {
          amount_shared: includeAmount,
        },
      };
    } catch (err) {
      const message = err?.message || 'Provider call failed';
      attempts.push({ provider: name, error: message });
      lastErr = err;
    }
  }

  const error = new Error(lastErr?.message || 'All AI providers failed');
  error.name = lastErr?.name || 'AiProviderError';
  error.attempts = attempts;
  throw error;
}

module.exports = {
  getAiStatus,
  generateTransactionSuggestions,
};
