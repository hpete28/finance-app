function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function asFloat(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBaseUrl(url) {
  return String(url || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
}

function normalizeProviderName(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'gemini' || normalized === 'ollama') return normalized;
  return fallback;
}

function getAiConfig() {
  const ollamaBaseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  const ollamaModel = String(process.env.OLLAMA_MODEL || 'llama3.1:8b').trim();
  const ollamaTimeoutMs = asNumber(process.env.OLLAMA_TIMEOUT_MS, 45000, 2000, 180000);
  const ollamaKeepAlive = String(process.env.OLLAMA_KEEP_ALIVE || '15m').trim();

  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const geminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const geminiTimeoutMs = asNumber(process.env.GEMINI_TIMEOUT_MS, 30000, 2000, 180000);
  const geminiBaseUrl = normalizeBaseUrl(process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta');

  const primaryProvider = normalizeProviderName(process.env.AI_PRIMARY_PROVIDER, 'gemini');
  const fallbackProvider = normalizeProviderName(process.env.AI_FALLBACK_PROVIDER, 'ollama');

  return {
    enabled: asBool(process.env.AI_FEATURES_ENABLED, false),
    provider: primaryProvider,
    primaryProvider,
    fallbackProvider,
    shareAmount: asBool(process.env.AI_SHARE_AMOUNT, false),
    maxBatch: asNumber(process.env.OLLAMA_MAX_BATCH, 80, 1, 200),
    minCategoryConfidence: asFloat(process.env.OLLAMA_MIN_CATEGORY_CONFIDENCE, 0.72, 0, 1),
    providers: {
      ollama: {
        name: 'ollama',
        baseUrl: ollamaBaseUrl,
        model: ollamaModel,
        timeoutMs: ollamaTimeoutMs,
        keepAlive: ollamaKeepAlive,
      },
      gemini: {
        name: 'gemini',
        apiKey: geminiApiKey,
        model: geminiModel,
        timeoutMs: geminiTimeoutMs,
        baseUrl: geminiBaseUrl,
      },
    },
    // Backward compatibility for existing calls that expect ollama-shaped config.
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    timeoutMs: ollamaTimeoutMs,
    keepAlive: ollamaKeepAlive,
  };
}

module.exports = { getAiConfig };
