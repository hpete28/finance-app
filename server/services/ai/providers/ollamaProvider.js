const { generateStructuredJson, getOllamaStatus } = require('../ollamaClient');

async function getStatus(providerConfig = {}) {
  const configured = !!(providerConfig.baseUrl && providerConfig.model);
  if (!configured) {
    return {
      name: 'ollama',
      configured: false,
      available: false,
      reachable: false,
      model: providerConfig.model || null,
      base_url: providerConfig.baseUrl || null,
      error: 'Ollama is not configured',
    };
  }

  const status = await getOllamaStatus({
    enabled: true,
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
    timeoutMs: providerConfig.timeoutMs,
  });

  return {
    name: 'ollama',
    configured: true,
    available: !!status.available,
    reachable: Array.isArray(status.models),
    model: status.model || providerConfig.model,
    base_url: status.base_url || providerConfig.baseUrl,
    model_available: !!status.model_available,
    error: status.error || null,
  };
}

async function generateTransactionSuggestions({ providerConfig, prompt }) {
  const raw = await generateStructuredJson({
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
    prompt,
    timeoutMs: providerConfig.timeoutMs,
    keepAlive: providerConfig.keepAlive,
  });

  return {
    provider: 'ollama',
    model: providerConfig.model,
    raw,
  };
}

module.exports = {
  name: 'ollama',
  isCloud: false,
  getStatus,
  generateTransactionSuggestions,
};
