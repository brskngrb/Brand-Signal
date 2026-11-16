export const LOCAL_MODEL = 'qwen3.5:4b';
export const PROVIDERS = ['local', 'openclaw', 'openai', 'gemini'];
export const defaultSettings = () => ({
  version: 2, provider: 'local', localModel: LOCAL_MODEL,
  openaiModel: 'gpt-6.1-sol', reasoningEffort: 'low', geminiModel: '', openclawModel: 'openclaw/main',
});

export function loadSettings(previous = {}) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) previous = {};
  const defaults = defaultSettings();
  return {
    ...defaults,
    provider: previous.version === 2 && PROVIDERS.includes(previous.provider) ? previous.provider : 'local',
    localModel: typeof previous.localModel === 'string' && previous.localModel.trim() ? previous.localModel : LOCAL_MODEL,
    openaiModel: previous.openaiModel || defaults.openaiModel,
    reasoningEffort: previous.reasoningEffort || defaults.reasoningEffort,
    geminiModel: previous.geminiModel || previous.model || '',
    openclawModel: previous.openclawModel || defaults.openclawModel,
  };
}

export const providerName = provider => ({local:'本地 Ollama', openclaw:'OpenClaw', openai:'OpenAI', gemini:'Gemini'})[provider] || provider;
export const sourceName = source => providerName(source?.replace(/_api$/, ''));
export const localProvider = provider => provider === 'local' || provider === 'openclaw';
export const isModelSource = source => PROVIDERS.some(provider => source === provider + '_api');
export function selectedModel(settings, health = {}, provider = settings.provider) {
  return provider === 'local' ? settings.localModel || health.localModel || LOCAL_MODEL
    : provider === 'openclaw' ? settings.openclawModel || 'openclaw/main'
    : provider === 'openai' ? settings.openaiModel || health.openaiModel || 'gpt-6.1-sol'
    : settings.geminiModel || health.model || undefined;
}
