class OllamaError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OllamaError';
    this.details = details;
  }
}

async function requestOllamaJson(baseUrl, path, { method = 'GET', body, timeoutMs = 12000, retries = 1 } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new OllamaError(`Ollama request failed (${res.status})`, {
          status: res.status,
          body: text.slice(0, 300),
        });

        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      const timeoutErr = err?.name === 'AbortError';
      const wrapped = timeoutErr
        ? new OllamaError('Ollama request timed out', { timeoutMs })
        : (err instanceof OllamaError ? err : new OllamaError(err.message || 'Ollama request failed'));

      if (attempt < retries) {
        lastErr = wrapped;
        continue;
      }
      throw wrapped;
    }
  }

  throw lastErr || new OllamaError('Ollama request failed');
}

async function listModels({ baseUrl, timeoutMs }) {
  const data = await requestOllamaJson(baseUrl, '/api/tags', { timeoutMs, retries: 1 });
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .map((m) => String(m?.name || '').trim())
    .filter(Boolean);
}

async function generateStructuredJson({ baseUrl, model, prompt, timeoutMs, keepAlive }) {
  const data = await requestOllamaJson(baseUrl, '/api/generate', {
    method: 'POST',
    timeoutMs,
    retries: 1,
    body: {
      model,
      prompt,
      stream: false,
      format: 'json',
      keep_alive: keepAlive || '15m',
      options: {
        temperature: 0,
      },
    },
  });

  const raw = data?.response;
  if (typeof raw === 'object' && raw !== null) return raw;

  if (typeof raw !== 'string' || !raw.trim()) {
    throw new OllamaError('Ollama returned empty response payload');
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new OllamaError('Ollama returned invalid JSON response');
  }
}

async function getOllamaStatus(config) {
  const checkedAt = new Date().toISOString();
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      provider: 'ollama',
      base_url: config.baseUrl,
      model: config.model,
      model_available: false,
      models: [],
      error: 'AI features are disabled by AI_FEATURES_ENABLED',
      checked_at: checkedAt,
    };
  }

  try {
    const models = await listModels(config);
    const modelAvailable = models.includes(config.model);
    return {
      enabled: true,
      available: modelAvailable,
      provider: 'ollama',
      base_url: config.baseUrl,
      model: config.model,
      model_available: modelAvailable,
      models,
      error: modelAvailable ? null : `Model "${config.model}" not found in Ollama`,
      checked_at: checkedAt,
    };
  } catch (err) {
    return {
      enabled: true,
      available: false,
      provider: 'ollama',
      base_url: config.baseUrl,
      model: config.model,
      model_available: false,
      models: [],
      error: err.message || 'Unable to reach Ollama',
      checked_at: checkedAt,
    };
  }
}

module.exports = {
  OllamaError,
  listModels,
  generateStructuredJson,
  getOllamaStatus,
};
