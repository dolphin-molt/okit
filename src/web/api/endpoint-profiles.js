// Endpoint profiles for Coding Plan / Token Plan providers whose /models
// endpoint is unreliable or absent. Centralises the probe-model selection and
// the known model fallback list so that connection tests (vault.testApiKey)
// and model discovery (providers.fetchModels) stay in sync.
//
// Each profile maps a baseUrl pattern to:
//   - probeModel: the model name to send in a 1-token chat/completions probe
//     when /models is unavailable. Must be a model the plan accepts.
//   - models: known model list to fall back to after a successful probe.
//
// Qianfan Coding is still handled by qianfan-coding.js (it has richer error
// messages); this module covers the remaining Coding Plan providers that were
// previously falling through to the generic gpt-4o-mini probe and failing.

const PROFILES = [
  {
    id: 'opencode-go-anthropic',
    // OpenCode Go Anthropic wire API uses /v1/messages and only accepts the
    // models documented for that protocol. Grok is OpenAI-compatible only.
    match: /^https?:\/\/opencode\.ai\/zen\/go\/?$/i,
    probeModel: 'minimax-m3',
    models: [
      { id: 'minimax-m3', name: 'MiniMax M3' },
      { id: 'minimax-m2.7', name: 'MiniMax M2.7' },
      { id: 'minimax-m2.5', name: 'MiniMax M2.5' },
      { id: 'qwen3.7-max', name: 'Qwen3.7 Max' },
      { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus' },
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus' },
    ],
  },
  {
    id: 'opencode-go-openai',
    // OpenCode-compatible /v1 endpoint. Grok is available on chat/completions.
    match: /^https?:\/\/opencode\.ai\/zen\/go\/v1\/?$/i,
    probeModel: 'grok-4.5',
    models: [
      { id: 'grok-4.5', name: 'Grok 4.5' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'glm-5.1', name: 'GLM-5.1' },
      { id: 'kimi-k3', name: 'Kimi K3' },
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
      { id: 'kimi-k2.6', name: 'Kimi K2.6' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'mimo-v2.5', name: 'MiMo V2.5' },
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
    ],
  },
  {
    id: 'zai-global-coding',
    // Z.AI international GLM Coding Plan.
    match: /^https?:\/\/api\.z\.ai\/api\/coding\//i,
    probeModel: 'glm-5.1',
    models: [
      { id: 'glm-5.1', name: 'GLM-5.1' },
      { id: 'glm-5', name: 'GLM-5' },
      { id: 'glm-4.7', name: 'GLM-4.7' },
    ],
  },
  {
    id: 'glm-coding',
    // GLM Coding Plan — open.bigmodel.cn/api/coding/...
    match: /^https?:\/\/open\.bigmodel\.cn\/api\/coding\//i,
    probeModel: 'glm-4.7',
    models: [
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'glm-5-turbo', name: 'GLM-5 Turbo' },
      { id: 'glm-4.7', name: 'GLM-4.7' },
    ],
  },
  {
    id: 'minimax-coding',
    // MiniMax Token Plan — mainland China and international endpoints.
    match: /^https?:\/\/api\.minimax(?:i\.com|\.io)\/(?:v1|anthropic)/i,
    probeModel: 'MiniMax-M2.7',
    models: [
      { id: 'MiniMax-M3', name: 'MiniMax M3' },
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed' },
      { id: 'MiniMax-M2.5', name: 'MiniMax M2.5' },
    ],
  },
  {
    id: 'volcengine-coding',
    // 火山引擎 Coding Plan — ark.cn-beijing.volces.com/api/coding/...
    match: /^https?:\/\/ark\.cn-beijing\.volces\.com\/api\/coding\//i,
    probeModel: 'doubao-seed-code-preview-251028',
    models: [
      { id: 'doubao-seed-code-preview-251028', name: 'Doubao Seed Code' },
      { id: 'doubao-seed-2.0-pro', name: 'Doubao Seed 2.0 Pro' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'deepseek-v3.2', name: 'DeepSeek V3.2' },
      { id: 'glm-5', name: 'GLM-5' },
    ],
  },
  {
    id: 'tencent-coding',
    // 腾讯云 Coding Plan — api.lkeap.cloud.tencent.com/coding/...
    match: /^https?:\/\/api\.lkeap\.cloud\.tencent\.com\/coding\//i,
    probeModel: 'tc-code-latest',
    models: [
      { id: 'tc-code-latest', name: 'Tencent Code' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'glm-5', name: 'GLM-5' },
      { id: 'minimax-m2.5', name: 'MiniMax M2.5' },
    ],
  },
  {
    id: 'kimi-coding-plan',
    // Kimi Coding Plan — api.kimi.com/coding/...
    match: /^https?:\/\/api\.kimi\.com\/coding\//i,
    probeModel: 'kimi-for-coding',
    models: [
      { id: 'k3', name: 'Kimi K3' },
      { id: 'k3-256k', name: 'Kimi K3 256K' },
      { id: 'kimi-for-coding', name: 'Kimi for Coding' },
      { id: 'kimi-for-coding-highspeed', name: 'Kimi for Coding Highspeed' },
    ],
  },
  {
    id: 'xiaomi-coding',
    // 小米 MiMo Token Plan — token-plan-*.xiaomimimo.com
    match: /^https?:\/\/token-plan-[^/]*\.xiaomimimo\.com\//i,
    probeModel: 'mimo-v2.5',
    models: [
      { id: 'mimo-v2.5', name: 'MiMo V2.5' },
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
    ],
  },
];

// Default probe model for generic OpenAI-compatible endpoints.
const DEFAULT_PROBE_MODEL = 'gpt-4o-mini';

/**
 * Returns the endpoint profile matching the given baseUrl, or null if no
 * Coding Plan pattern matches.
 */
function getEndpointProfile(baseUrl) {
  const url = String(baseUrl || '').trim();
  return PROFILES.find(p => p.match.test(url)) || null;
}

/**
 * Picks the correct probe model for a given endpoint. Coding Plan endpoints
 * reject the generic gpt-4o-mini model, so we must use a plan-specific one.
 */
function pickProbeModel(baseUrl) {
  const profile = getEndpointProfile(baseUrl);
  return profile ? profile.probeModel : DEFAULT_PROBE_MODEL;
}

/**
 * Returns the known model fallback list for a Coding Plan endpoint, or null
 * if the endpoint is not a recognised Coding Plan.
 */
function getFallbackModels(baseUrl) {
  const profile = getEndpointProfile(baseUrl);
  return profile ? profile.models.slice() : null;
}

module.exports = {
  PROFILES,
  DEFAULT_PROBE_MODEL,
  getEndpointProfile,
  pickProbeModel,
  getFallbackModels,
};
