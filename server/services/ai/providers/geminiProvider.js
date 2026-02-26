const { parseLooseJson } = require('./base');

class GeminiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'GeminiError';
    this.details = details;
  }
}

function normalizeModelRef(model) {
  const raw = String(model || '').trim();
  if (!raw) return 'models/gemini-2.5-flash';
  return raw.startsWith('models/') ? raw : `models/${raw}`;
}

async function requestGeminiJson(url, apiKey, { method = 'GET', body, timeoutMs = 30000, retries = 1 } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new GeminiError(`Gemini request failed (${res.status})`, {
          status: res.status,
          body: text.slice(0, 400),
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
      const wrapped = err?.name === 'AbortError'
        ? new GeminiError('Gemini request timed out', { timeoutMs })
        : (err instanceof GeminiError ? err : new GeminiError(err?.message || 'Gemini request failed'));

      if (attempt < retries) {
        lastErr = wrapped;
        continue;
      }
      throw wrapped;
    }
  }

  throw lastErr || new GeminiError('Gemini request failed');
}

function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => String(p?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function getStatus(providerConfig = {}) {
  const configured = !!providerConfig.apiKey;
  const modelRef = normalizeModelRef(providerConfig.model);
  if (!configured) {
    return {
      name: 'gemini',
      configured: false,
      available: false,
      reachable: false,
      model: modelRef,
      error: 'Gemini API key is not configured',
    };
  }

  try {
    const url = `${providerConfig.baseUrl}/${modelRef}`;
    await requestGeminiJson(url, providerConfig.apiKey, {
      method: 'GET',
      timeoutMs: providerConfig.timeoutMs,
      retries: 0,
    });

    return {
      name: 'gemini',
      configured: true,
      available: true,
      reachable: true,
      model: modelRef,
      error: null,
    };
  } catch (err) {
    return {
      name: 'gemini',
      configured: true,
      available: false,
      reachable: false,
      model: modelRef,
      error: err?.message || 'Gemini unavailable',
    };
  }
}

async function generateTransactionSuggestions({ providerConfig, prompt }) {
  if (!providerConfig.apiKey) {
    throw new GeminiError('Gemini API key is not configured');
  }

  const modelRef = normalizeModelRef(providerConfig.model);
  const url = `${providerConfig.baseUrl}/${modelRef}:generateContent`;
  const data = await requestGeminiJson(url, providerConfig.apiKey, {
    method: 'POST',
    timeoutMs: providerConfig.timeoutMs,
    retries: 1,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    },
  });

  const text = extractCandidateText(data);
  const raw = parseLooseJson(text);
  if (!raw) {
    throw new GeminiError('Gemini returned invalid JSON response');
  }

  return {
    provider: 'gemini',
    model: modelRef,
    raw,
  };
}

module.exports = {
  GeminiError,
  name: 'gemini',
  isCloud: true,
  getStatus,
  generateTransactionSuggestions,
};
