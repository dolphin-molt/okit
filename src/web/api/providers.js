const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { backupImportantData } = require('./backup');
const {
  isQianfanCodingEndpoint,
  qianfanCodingErrorCode,
  qianfanCodingErrorMessage,
  qianfanCodingModels,
} = require('./qianfan-coding');
const { pickProbeModel, getFallbackModels } = require('./endpoint-profiles');

const OKIT_DIR = path.join(os.homedir(), '.okit');
const PROVIDERS_PATH = path.join(OKIT_DIR, 'providers.json');
const USER_CONFIG_PATH = path.join(OKIT_DIR, 'user.json');
const RETIRED_PRESET_PROVIDER_IDS = new Set(['groq', 'fireworks', 'together']);
// Apply only this exact built-in endpoint correction. User-customized URLs are
// intentionally left untouched when presets are refreshed.
const PRESET_BASE_URL_MIGRATIONS = new Map([
  ['kimi-coding', { from: 'https://api.kimi.com', to: 'https://api.moonshot.cn/v1' }],
  ['qianfan-coding', { from: 'https://qianfan.baidubce.com/v2/coding', to: 'https://qianfan.baidubce.com/v2/tokenplan/personal' }],
  ['xiaomi-coding', { from: 'https://token-plan-cn.xiaomimimo.com/v1', to: 'https://token-plan-sgp.xiaomimimo.com/v1' }],
]);
const PRESET_ENDPOINT_BASE_URL_MIGRATIONS = new Map([
  ['kimi-coding-plan', { from: 'https://api.kimi.com/coding/', to: 'https://api.kimi.com/coding' }],
  ['xiaomi-coding', { from: 'https://token-plan-cn.xiaomimimo.com/anthropic', to: 'https://token-plan-sgp.xiaomimimo.com/anthropic' }],
]);

const PRESET_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    authMode: "both",
    models: [
      { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    authMode: "api_key",
    models: [
      { id: "gpt-5.5", name: "GPT-5.5" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "o3", name: "O3" },
      { id: "o4-mini", name: "O4 Mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
    ],
  },
  {
    id: "openai-codex",
    name: "ChatGPT",
    type: "openai",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    authMode: "oauth",
    models: [
      { id: "codex-1", name: "Codex 1" },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    type: "google",
    baseUrl: "https://generativelanguage.googleapis.com",
    endpoints: [
      { type: "google", baseUrl: "https://generativelanguage.googleapis.com" },
      { type: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
    ],
    authMode: "api_key",
    models: [
      { id: "gemini-3", name: "Gemini 3" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    ],
  },
  {
    id: "volcengine",
    name: "火山引擎",
    type: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    authMode: "api_key",
    models: [
      { id: "doubao-seed-2.0-pro", name: "Doubao Seed 2.0 Pro" },
      { id: "doubao-seed-1-8-251228", name: "Doubao Seed 1.8" },
      { id: "doubao-seed-code-preview-251028", name: "Doubao Seed Code" },
      { id: "doubao-1-5-pro-32k-250115", name: "Doubao 1.5 Pro 32K" },
      { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
      { id: "glm-4.7", name: "GLM-4.7" },
      { id: "glm-5", name: "GLM-5" },
      { id: "kimi-k2.5", name: "Kimi K2.5" },
    ],
  },
  {
    id: "zai",
    name: "智谱 AI（国内站）",
    type: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    endpoints: [
      { type: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
      { type: "anthropic", baseUrl: "https://open.bigmodel.cn/api/anthropic" },
    ],
    authMode: "api_key",
    models: [
      { id: "glm-5.1", name: "GLM-5.1" },
      { id: "glm-5", name: "GLM-5" },
      { id: "glm-5-turbo", name: "GLM-5 Turbo" },
      { id: "glm-5v-turbo", name: "GLM-5V Turbo" },
      { id: "glm-4.7", name: "GLM-4.7" },
      { id: "glm-4.7-flash", name: "GLM-4.7 Flash" },
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-ocr", name: "GLM OCR" },
    ],
  },
  {
    id: "zai-global",
    name: "Z.AI（国际站）",
    type: "openai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    endpoints: [
      { type: "openai", baseUrl: "https://api.z.ai/api/paas/v4" },
      { type: "anthropic", baseUrl: "https://api.z.ai/api/anthropic" },
    ],
    authMode: "api_key",
    models: [
      { id: "glm-5.1", name: "GLM-5.1" },
      { id: "glm-5", name: "GLM-5" },
      { id: "glm-5-turbo", name: "GLM-5 Turbo" },
      { id: "glm-5v-turbo", name: "GLM-5V Turbo" },
      { id: "glm-4.7", name: "GLM-4.7" },
      { id: "glm-4.7-flash", name: "GLM-4.7 Flash" },
      { id: "glm-4.6", name: "GLM-4.6" },
      { id: "glm-ocr", name: "GLM OCR" },
    ],
  },
  {
    id: "minimax",
    name: "MiniMax（国内站）",
    type: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    authMode: "api_key",
    models: [
      { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
      { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
      { id: "MiniMax-M2", name: "MiniMax M2" },
      { id: "MiniMax-Text-01", name: "MiniMax Text 01" },
    ],
  },
  {
    id: "minimax-global",
    name: "MiniMax（国际站）",
    type: "openai",
    baseUrl: "https://api.minimax.io/v1",
    authMode: "api_key",
    models: [
      { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
      { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
      { id: "MiniMax-M2", name: "MiniMax M2" },
      { id: "MiniMax-Text-01", name: "MiniMax Text 01" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai",
    baseUrl: "https://api.deepseek.com",
    endpoints: [
      { type: "openai", baseUrl: "https://api.deepseek.com" },
      { type: "anthropic", baseUrl: "https://api.deepseek.com/anthropic" },
    ],
    authMode: "api_key",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { id: "deepseek-chat", name: "DeepSeek Chat (V4)" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner (V4)" },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi Global)",
    type: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    authMode: "api_key",
    models: [
      { id: "kimi-latest", name: "Kimi Latest" },
      { id: "moonshot-v1-128k", name: "Moonshot V1 128K" },
      { id: "moonshot-v1-32k", name: "Moonshot V1 32K" },
      { id: "moonshot-v1-8k", name: "Moonshot V1 8K" },
    ],
  },
  {
    id: "kimi-coding",
    // Keep this ID for existing configurations while presenting it as Kimi.
    name: "Kimi",
    type: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    authMode: "api_key",
    models: [
      { id: "kimi-k2.5", name: "Kimi K2.5" },
      { id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
      { id: "kimi-code", name: "Kimi Code" },
    ],
  },
  {
    id: "kimi-coding-plan",
    name: "Kimi Coding Plan",
    type: "openai",
    baseUrl: "https://api.kimi.com/coding/v1",
    endpoints: [
      { type: "openai", protocol: "chat", baseUrl: "https://api.kimi.com/coding/v1", plan: "coding" },
      { type: "anthropic", baseUrl: "https://api.kimi.com/coding", plan: "coding" },
    ],
    authMode: "api_key",
    models: [
      { id: "kimi-k2.5", name: "Kimi K2.5" },
      { id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
      { id: "kimi-code", name: "Kimi Code" },
    ],
  },
  {
    id: "qwen",
    name: "通义千问 (Qwen)",
    type: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authMode: "api_key",
    models: [
      { id: "qwen3.6-max-preview", name: "Qwen3.6 Max Preview" },
      { id: "qwen-max", name: "Qwen Max" },
      { id: "qwen-plus", name: "Qwen Plus" },
      { id: "qwen-turbo", name: "Qwen Turbo" },
      { id: "qwen3-235b", name: "Qwen3 235B" },
      { id: "qwen3-32b", name: "Qwen3 32B" },
    ],
  },
  {
    id: "qianfan",
    name: "百度千帆",
    type: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2",
    authMode: "api_key",
    models: [
      { id: "ernie-4.5-8k-preview", name: "ERNIE 4.5" },
      { id: "ernie-4.0-8k", name: "ERNIE 4.0" },
      { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
    ],
  },
  {
    id: "qianfan-coding",
    name: "百度千帆 Coding Plan",
    type: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2/tokenplan/personal",
    authMode: "api_key",
    models: [
      { id: "qianfan-code-latest", name: "Qianfan Code" },
      { id: "kimi-k2.5", name: "Kimi K2.5" },
      { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
      { id: "glm-5", name: "GLM-5" },
      { id: "minimax-m2.5", name: "MiniMax M2.5" },
      { id: "ernie-4.5-turbo-20260402", name: "ERNIE 4.5 Turbo" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "glm-5.1", name: "GLM-5.1" },
    ],
  },
  {
    id: "glm-coding",
    name: "GLM Coding Plan",
    type: "openai",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    endpoints: [
      { type: "openai", protocol: "chat", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", plan: "coding" },
      { type: "anthropic", baseUrl: "https://open.bigmodel.cn/api/anthropic", plan: "coding" },
    ],
    authMode: "api_key",
    models: [
      { id: "glm-5.2", name: "GLM-5.2" },
      { id: "glm-5-turbo", name: "GLM-5 Turbo" },
      { id: "glm-4.7", name: "GLM-4.7" },
    ],
  },
  {
    id: "minimax-coding",
    name: "MiniMax Token Plan",
    type: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    endpoints: [
      { type: "openai", protocol: "chat", baseUrl: "https://api.minimaxi.com/v1", plan: "token" },
      { type: "anthropic", baseUrl: "https://api.minimaxi.com/anthropic", plan: "token" },
    ],
    authMode: "api_key",
    models: [
      { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
      { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
      { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    ],
  },
  {
    id: "volcengine-coding",
    name: "火山引擎 Coding Plan",
    type: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    endpoints: [
      { type: "openai", protocol: "chat", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", plan: "coding" },
      { type: "anthropic", baseUrl: "https://ark.cn-beijing.volces.com/api/coding", plan: "coding" },
    ],
    authMode: "api_key",
    models: [
      { id: "doubao-seed-code-preview-251028", name: "Doubao Seed Code" },
      { id: "doubao-seed-2.0-pro", name: "Doubao Seed 2.0 Pro" },
      { id: "kimi-k2.5", name: "Kimi K2.5" },
      { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
      { id: "glm-5", name: "GLM-5" },
    ],
  },
  {
    id: "tencent-coding",
    name: "腾讯云 Coding Plan",
    type: "openai",
    baseUrl: "https://api.lkeap.cloud.tencent.com/coding/v3",
    endpoints: [
      { type: "openai", protocol: "chat", baseUrl: "https://api.lkeap.cloud.tencent.com/coding/v3", plan: "coding" },
      { type: "anthropic", baseUrl: "https://api.lkeap.cloud.tencent.com/coding/anthropic", plan: "coding" },
    ],
    authMode: "api_key",
    models: [
      { id: "tc-code-latest", name: "Tencent Code" },
      { id: "kimi-k2.5", name: "Kimi K2.5" },
      { id: "glm-5", name: "GLM-5" },
      { id: "minimax-m2.5", name: "MiniMax M2.5" },
    ],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    type: "openai",
    baseUrl: "https://api.x.ai/v1",
    authMode: "api_key",
    models: [
      { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning" },
      { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20" },
      { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast Reasoning" },
      { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast" },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    type: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    authMode: "api_key",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large 3" },
      { id: "devstral-medium-latest", name: "Devstral Medium" },
      { id: "devstral-small-latest", name: "Devstral Small" },
      { id: "mistral-medium-latest", name: "Mistral Medium 3" },
      { id: "mistral-small-latest", name: "Mistral Small 3" },
    ],
  },
  {
    id: "stepfun",
    name: "阶跃星辰 (StepFun)",
    type: "openai",
    baseUrl: "https://api.stepfun.com/v1",
    authMode: "api_key",
    models: [
      { id: "step-3.5-flash", name: "Step 3.5 Flash" },
      { id: "step-2", name: "Step 2" },
      { id: "step-1-flash", name: "Step 1 Flash" },
    ],
  },
  {
    id: "xiaomi",
    name: "小米 MiMo",
    type: "openai",
    baseUrl: "https://api.xiaomimimo.com/v1",
    endpoints: [
      { type: "openai", baseUrl: "https://api.xiaomimimo.com/v1" },
      { type: "anthropic", baseUrl: "https://api.xiaomimimo.com/anthropic" },
    ],
    authMode: "api_key",
    models: [
      { id: "MiMo-V2-Pro", name: "MiMo V2 Pro" },
      { id: "MiMo-V2-Flash", name: "MiMo V2 Flash" },
    ],
  },
  {
    id: "xiaomi-coding",
    name: "小米 MiMo Token Plan",
    type: "openai",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    endpoints: [
      { type: "openai", protocol: "chat", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1", plan: "token" },
      { type: "anthropic", baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic", plan: "token" },
    ],
    authMode: "api_key",
    models: [
      { id: "mimo-v2.5", name: "MiMo V2.5" },
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
      { id: "mimo-v2.5-asr", name: "MiMo V2.5 ASR" },
      { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS" },
      { id: "mimo-v2.5-tts-voiceclone", name: "MiMo V2.5 TTS Voice Clone" },
      { id: "mimo-v2.5-tts-voicedesign", name: "MiMo V2.5 TTS Voice Design" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    authMode: "api_key",
    models: [
      { id: "anthropic/claude-opus-4-7", name: "Claude Opus 4.7" },
      { id: "openai/gpt-5.5", name: "GPT-5.5" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    type: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    authMode: "api_key",
    models: [],
  },
  {
    id: "litellm",
    name: "LiteLLM (本地)",
    type: "openai",
    baseUrl: "http://localhost:4000",
    authMode: "api_key",
    models: [],
  },
];

async function loadProviders() {
  if (!(await fs.pathExists(PROVIDERS_PATH))) {
    await saveProviders(PRESET_PROVIDERS);
    return PRESET_PROVIDERS;
  }
  try {
    const content = await fs.readFile(PROVIDERS_PATH, 'utf-8');
    const data = JSON.parse(content);
    const sourceProviders = Array.isArray(data.providers) ? data.providers : [];
    const providers = sourceProviders.filter(p => !RETIRED_PRESET_PROVIDER_IDS.has(p.id));

    // Merge new presets: add missing ones, update name changes, and apply
    // narrowly-scoped endpoint migrations for known broken built-in defaults.
    let changed = providers.length !== sourceProviders.length;
    for (const preset of PRESET_PROVIDERS) {
      const existing = providers.find(p => p.id === preset.id);
      if (!existing) {
        providers.push(preset);
        changed = true;
      } else {
        const migration = PRESET_BASE_URL_MIGRATIONS.get(preset.id);
        if (migration) {
          if (existing.baseUrl === migration.from) {
            existing.baseUrl = migration.to;
            changed = true;
          }
          // Model Management reads `endpoints` when it is present. Migrate the
          // same known stale URL there too; otherwise the card looks updated
          // while its connection test still calls the old endpoint.
          if (Array.isArray(existing.endpoints)) {
            let endpointChanged = false;
            existing.endpoints = existing.endpoints.map(endpoint => {
              if (endpoint && endpoint.baseUrl === migration.from) {
                endpointChanged = true;
                return { ...endpoint, baseUrl: migration.to };
              }
              return endpoint;
            });
            if (endpointChanged) changed = true;
          }
        }
        const endpointMigration = PRESET_ENDPOINT_BASE_URL_MIGRATIONS.get(preset.id);
        if (endpointMigration && Array.isArray(existing.endpoints)) {
          let endpointChanged = false;
          existing.endpoints = existing.endpoints.map(endpoint => {
            if (endpoint && endpoint.baseUrl === endpointMigration.from) {
              endpointChanged = true;
              return { ...endpoint, baseUrl: endpointMigration.to };
            }
            return endpoint;
          });
          if (endpointChanged) changed = true;
        }
        if (existing.name !== preset.name) {
          existing.name = preset.name;
          changed = true;
        }
        if (
          preset.id === 'qianfan-coding'
          && existing.models.some(model => ['kimi-k2.5', 'deepseek-v3.2', 'minimax-m2.5', 'ernie-4.5-turbo-20260402'].includes(model.id))
        ) {
          existing.models = preset.models.map(model => ({ ...model }));
          changed = true;
        }
        if (
          preset.id === 'xiaomi-coding'
          && existing.models.length === 4
          && existing.models.every(model => ['mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-asr', 'mimo-v2.5-tts'].includes(model.id))
        ) {
          existing.models = preset.models.map(model => ({ ...model }));
          changed = true;
        }
      }
    }
    // Coding Plan uses a separate API-key scope. Older builds put the Coding
    // endpoint beside the regular Qianfan endpoint, which made one ordinary
    // key look partially broken forever. Keep the regular provider regular;
    // the dedicated qianfan-coding preset owns that endpoint now.
    const qianfan = providers.find(provider => provider.id === 'qianfan');
    if (qianfan && Array.isArray(qianfan.endpoints)) {
      const filtered = qianfan.endpoints.filter(endpoint =>
        !/^https?:\/\/qianfan\.baidubce\.com\/v2\/(?:coding|tokenplan\/personal)\/?$/i.test(endpoint.baseUrl),
      );
      if (filtered.length !== qianfan.endpoints.length) {
        if (filtered.length) qianfan.endpoints = filtered;
        else delete qianfan.endpoints;
        if (qianfan.baseUrl === 'https://qianfan.baidubce.com/v2/coding') {
          qianfan.baseUrl = 'https://qianfan.baidubce.com/v2';
        }
        changed = true;
      }
    }
    if (changed) await saveProviders(providers);

    return providers;
  } catch { return []; }
}

async function saveProviders(providers) {
  await fs.ensureDir(OKIT_DIR);
  await backupImportantData('providers');
  await fs.writeFile(PROVIDERS_PATH, JSON.stringify({ providers }, null, 2));
}

async function loadUserConfig() {
  try {
    if (!(await fs.pathExists(USER_CONFIG_PATH))) return {};
    const content = await fs.readFile(USER_CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch { return {}; }
}

async function saveUserConfig(config) {
  await fs.ensureDir(OKIT_DIR);
  await backupImportantData('user');
  await fs.writeFile(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
}

const ADAPTERS = [
  { id: 'claude', name: 'Claude Code', supportedTypes: ['anthropic'], command: 'claude', launchType: 'cli' },
  { id: 'codex', name: 'Codex', supportedTypes: ['openai'], command: 'codex', launchType: 'cli' },
  { id: 'gemini', name: 'Gemini', supportedTypes: ['google'], command: 'gemini', launchType: 'cli' },
  { id: 'opencode', name: 'OpenCode', supportedTypes: ['anthropic', 'openai', 'google'], command: 'opencode', launchType: 'cli' },
  { id: 'openclaw', name: 'OpenClaw', supportedTypes: ['anthropic', 'openai', 'google'], command: 'openclaw', launchType: 'cli' },
  { id: 'workbuddy', name: 'WorkBuddy', supportedTypes: ['anthropic', 'openai', 'google'], command: 'workbuddy', launchType: 'app', appName: 'WorkBuddy' },
  { id: 'zcode', name: 'ZCode', supportedTypes: ['anthropic', 'openai', 'google'], command: 'zcode', launchType: 'app', appName: 'ZCode' },
  { id: 'hermes', name: 'Hermes', supportedTypes: ['anthropic', 'openai', 'google'], command: 'hermes', launchType: 'cli' },
  { id: 'kimi-code', name: 'Kimi Code', supportedTypes: ['openai'], command: 'kimi', launchType: 'cli' },
];

function adapterSupportsProvider(adapter, provider) {
  const providerTypes = provider.endpoints?.map(e => e.type) || [provider.type];
  return providerTypes.some(type => adapter.supportedTypes.includes(type));
}

async function listProviders(req, res) {
  try {
    const providers = await loadProviders();
    const config = await loadUserConfig();
    const providersConfig = config.providers || {};

    // Attach current selection info
    const result = providers.map(p => {
      return {
        ...p,
        usedBy: ADAPTERS
          .filter(a => adapterSupportsProvider(a, p) && providersConfig[a.id]?.providerId === p.id)
          .map(a => ({ id: a.id, name: a.name, modelId: providersConfig[a.id]?.modelId })),
      };
    });

    res.json({ providers: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAdaptersList(req, res) {
  try {
    const providers = await loadProviders();
    const config = await loadUserConfig();
    const providersConfig = config.providers || {};

    const result = ADAPTERS.map(adapter => {
      const sel = providersConfig[adapter.id];
      const currentProvider = sel?.providerId ? providers.find(p => p.id === sel.providerId) : null;
      const compatible = providers.filter(p => adapterSupportsProvider(adapter, p));

      return {
        ...adapter,
        launchType: adapter.launchType || 'cli',
        canLaunch: !!adapter.command,
        installed: adapter.launchType === 'app' ? true : (adapter.command ? !!findCommand(adapter.command) : false),
        current: sel?.providerId && sel?.modelId
          ? { providerId: sel.providerId, providerName: currentProvider?.name || sel.providerId, modelId: sel.modelId }
          : null,
        compatibleProviders: compatible.map(p => ({
          id: p.id,
          name: p.name,
          type: p.type,
          models: p.models,
        })),
      };
    });

    res.json({ adapters: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function launchAgent(req, res) {
  const { agentId, cwd } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  const adapter = ADAPTERS.find(a => a.id === agentId);
  if (!adapter) return res.status(404).json({ error: `Agent not found: ${agentId}` });
  if (!adapter.command) return res.status(400).json({ error: `${adapter.name} 不支持一键打开` });

  try {
    if (adapter.launchType === 'app') {
      const appName = adapter.appName || adapter.name;
      const { spawn } = require('child_process');
      if (os.platform() === 'darwin') {
        spawn('open', ['-a', appName], { detached: true, stdio: 'ignore' }).unref();
      } else if (os.platform() === 'win32') {
        spawn('cmd', ['/c', 'start', '', appName], { detached: true, stdio: 'ignore', shell: true }).unref();
      } else {
        spawn(adapter.command, [], { detached: true, stdio: 'ignore' }).unref();
      }
      res.json({ success: true, agentId, launched: 'app', appName });
      return;
    }

    const commandPath = findCommand(adapter.command);
    if (!commandPath) {
      return res.status(404).json({ error: `${adapter.name} CLI 未安装或不在 PATH 中` });
    }

    const launchDir = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : process.cwd();
    const command = `cd ${shellQuote(launchDir)} && ${shellQuote(commandPath)}`;

    await openTerminal(command);
    res.json({ success: true, agentId, command: adapter.command });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function openTerminal(command) {
  // safe: command is internally generated, not from user input
  if (typeof command !== 'string') throw new Error('command must be a string');
  const { spawn } = require('child_process');
  const platform = os.platform();

  if (platform === 'darwin') {
    const script = [
      'tell application "Terminal"',
      'activate',
      `do script ${appleScriptQuote(command)}`,
      'end tell',
    ].join('\n');
    return spawnDetached('osascript', ['-e', script]);
  }

  if (platform === 'linux') {
    // safe: command is internally generated, not from user input. bash -lc is intentional
    // for terminal launch; the command is constructed from validated paths in launchAgent.
    const terminals = [
      ['gnome-terminal', ['--', 'bash', '-lc', `${command}; exec bash`]],
      ['konsole', ['-e', 'bash', '-lc', `${command}; exec bash`]],
      ['xterm', ['-e', 'bash', '-lc', `${command}; exec bash`]],
    ];
    const found = terminals.find(([cmd]) => findCommand(cmd));
    if (!found) throw new Error('未找到可用终端应用');
    return spawnDetached(found[0], found[1]);
  }

  if (platform === 'win32') {
    return spawnDetached('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', command]);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.unref();
    resolve();
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function appleScriptQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function createProvider(req, res) {
  try {
    const providers = await loadProviders();
    const { id, name, type, baseUrl, endpoints, vaultKey, authMode, authVerified, models } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: 'Missing required fields: id, name' });
    }

    const provider = {
      id,
      name,
      type: type || (endpoints && endpoints[0] ? endpoints[0].type : 'openai'),
      baseUrl: baseUrl || (endpoints && endpoints[0] ? endpoints[0].baseUrl : ''),
      endpoints: endpoints || undefined,
      vaultKey: vaultKey || undefined,
      authMode: authMode || 'api_key',
      models: models || [],
    };
    if (typeof authVerified === 'boolean') provider.authVerified = authVerified;

    const idx = providers.findIndex(p => p.id === id);
    if (idx >= 0) providers[idx] = provider;
    else providers.push(provider);

    await saveProviders(providers);
    res.json({ success: true, provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateProvider(req, res) {
  try {
    const { id } = req.params;
    const providers = await loadProviders();
    const idx = providers.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Provider not found' });

    providers[idx] = { ...providers[idx], ...req.body, id };
    await saveProviders(providers);
    res.json({ success: true, provider: providers[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteProviderRoute(req, res) {
  try {
    const { id } = req.params;
    const providers = await loadProviders();
    const idx = providers.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Provider not found' });

    providers.splice(idx, 1);
    await saveProviders(providers);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function switchProvider(req, res) {
  try {
    const { agentId, providerId, modelId } = req.body;
    if (!agentId || !providerId || !modelId) {
      return res.status(400).json({ error: 'Missing required fields: agentId, providerId, modelId' });
    }

    const adapter = ADAPTERS.find(a => a.id === agentId);
    if (!adapter) return res.status(404).json({ error: `Agent not found: ${agentId}` });

    const providers = await loadProviders();
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return res.status(404).json({ error: `Provider not found: ${providerId}` });

    if (!adapterSupportsProvider(adapter, provider)) {
      return res.status(400).json({ error: `${adapter.name} does not support ${provider.type} providers` });
    }

    const model = provider.models.find(m => m.id === modelId);
    if (!model) return res.status(400).json({ error: `Model not found: ${modelId}` });

    // Apply config to agent
    await applyAgentConfig(adapter, provider, modelId);

    // Save selection
    const config = await loadUserConfig();
    if (!config.providers) config.providers = {};
    config.providers[agentId] = { providerId, modelId };

    // For Claude, also update legacy path
    if (agentId === 'claude') {
      config.claude = { ...config.claude, name: provider.name, model: modelId };
    }

    await saveUserConfig(config);

    res.json({ success: true, agentId, providerId, modelId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function applyAgentConfig(adapter, provider, modelId) {
  const apiKey = provider.vaultKey ? await resolveVaultKey(provider.vaultKey) : undefined;

  switch (adapter.id) {
    case 'claude':
      await applyClaudeConfig(provider, modelId, apiKey);
      break;
    case 'codex':
      await applyCodexConfig(provider, modelId, apiKey);
      break;
    case 'gemini':
      await applyGeminiConfig(apiKey);
      break;
    case 'openclaw':
      await applyOpenClawConfig(provider, modelId, apiKey);
      break;
    case 'workbuddy':
      await applyWorkBuddyConfig(provider, modelId, apiKey);
      break;
    case 'zcode':
      await applyJsonAgentConfig(provider, modelId, apiKey, path.join(os.homedir(), '.zcode', 'config.json'));
      break;
    case 'hermes':
      await applyJsonAgentConfig(provider, modelId, apiKey, path.join(os.homedir(), '.hermes', 'config.json'));
      break;
    case 'kimi-code':
      await applyKimiCodeConfig(provider, modelId, apiKey);
      break;
    case 'opencode':
      await applyOpenCodeConfig(provider, modelId, apiKey);
      break;
    default:
      break;
  }
}

async function resolveVaultKey(vaultKey) {
  try {
    const store = require('../../vault/store').VaultStore;
    const instance = new store();
    let value = await instance.get(vaultKey);
    if (value) return value;
    const parsed = store.parseKeyAlias(vaultKey);
    return await instance.resolve(parsed.key, parsed.alias);
  } catch {
    return undefined;
  }
}

async function applyClaudeConfig(provider, modelId, apiKey) {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  await fs.ensureDir(path.dirname(settingsPath));

  let data = {};
  if (await fs.pathExists(settingsPath)) {
    const content = await fs.readFile(settingsPath, 'utf-8');
    data = content.trim() ? JSON.parse(content) : {};
  }

  const env = (typeof data.env === 'object' && data.env) ? { ...data.env } : {};
  const isOfficial = provider.baseUrl === 'https://api.anthropic.com' && !apiKey;

  if (isOfficial) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_MODEL;
  } else {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    env.ANTHROPIC_MODEL = modelId;
    if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
    else delete env.ANTHROPIC_AUTH_TOKEN;
  }

  if (Object.keys(env).length === 0) delete data.env;
  else data.env = env;

  await fs.writeFile(settingsPath, JSON.stringify(data, null, 2));
}

async function applyCodexConfig(provider, modelId, apiKey) {
  const codexDir = path.join(os.homedir(), '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  const envPath = path.join(codexDir, '.env');

  await fs.ensureDir(codexDir);
  let toml = '';
  if (await fs.pathExists(configPath)) {
    toml = await fs.readFile(configPath, 'utf-8');
  }

  const providerId = getCodexProviderId(provider);
  const openAIEndpoint = getProviderEndpoint(provider, 'openai');

  toml = upsertTopLevelTomlKey(toml, 'model', tomlString(modelId));
  toml = upsertTopLevelTomlKey(toml, 'model_provider', tomlString(providerId));

  if (providerId !== 'openai') {
    const envKey = getCodexEnvKey(provider);
    const providerLines = [
      `name = ${tomlString(provider.name)}`,
      `base_url = ${tomlString(openAIEndpoint.baseUrl)}`,
      `env_key = ${tomlString(envKey)}`,
      'wire_api = "responses"',
    ];
    toml = upsertTomlTable(toml, `model_providers.${providerId}`, providerLines);
    if (apiKey) await upsertEnvFile(envPath, envKey, apiKey);
  } else if (apiKey) {
    await upsertEnvFile(envPath, 'OPENAI_API_KEY', apiKey);
  }

  await fs.writeFile(configPath, toml);
}

function getProviderEndpoint(provider, type) {
  const endpoints = provider.endpoints || [{ type: provider.type, baseUrl: provider.baseUrl }];
  const endpoint = endpoints.find(ep => ep.type === type);
  if (!endpoint?.baseUrl) throw new Error(`${provider.name} 缺少 ${type} endpoint`);
  return endpoint;
}

function getCodexProviderId(provider) {
  return provider.id === 'openai' ? 'openai' : `okit-${sanitizeTomlKey(provider.id)}`;
}

function getCodexEnvKey(provider) {
  return `OKIT_CODEX_${provider.id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_API_KEY`;
}

function sanitizeTomlKey(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function upsertTopLevelTomlKey(toml, key, value) {
  const lines = toml.split('\n');
  let tableStart = lines.findIndex(line => line.trim().startsWith('['));
  if (tableStart === -1) tableStart = lines.length;

  for (let i = 0; i < tableStart; i++) {
    if (new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(lines[i])) {
      lines[i] = `${key} = ${value}`;
      return lines.join('\n');
    }
  }

  lines.splice(tableStart, 0, `${key} = ${value}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function upsertTomlTable(toml, tableName, lines) {
  const header = `[${tableName}]`;
  const tableBlock = `${header}\n${lines.join('\n')}`;
  const tableRegex = new RegExp(`(^\\[${escapeRegex(tableName)}\\]\\n)([\\s\\S]*?)(?=^\\[|\\s*$)`, 'm');

  if (tableRegex.test(toml)) {
    return toml.replace(tableRegex, `${tableBlock}\n\n`);
  }

  return `${toml.trimEnd()}\n\n${tableBlock}\n`;
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function upsertEnvFile(envPath, key, value) {
  let content = '';
  if (await fs.pathExists(envPath)) {
    content = await fs.readFile(envPath, 'utf-8');
  }

  const line = `export ${key}=${shellQuote(value)}`;
  const regex = new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(key)}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, line)
    : `${content.trimEnd()}\n${line}\n`;

  await fs.writeFile(envPath, content.trimStart());
}

async function applyGeminiConfig(apiKey) {
  if (apiKey) {
    const geminiDir = path.join(os.homedir(), '.gemini');
    await fs.ensureDir(geminiDir);
    await fs.writeFile(path.join(geminiDir, '.env'), `GEMINI_API_KEY=${apiKey}\nGOOGLE_API_KEY=${apiKey}\n`);
  }
}

async function applyOpenClawConfig(provider, modelId, apiKey) {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  await fs.ensureDir(path.dirname(configPath));

  let data = {};
  if (await fs.pathExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf-8');
    data = content.trim() ? JSON.parse(content) : {};
  }

  if (!data.models) data.models = {};
  if (!data.models.providers) data.models.providers = [];

  const providers = data.models.providers;
  let found = providers.find(p => p.id === provider.id);
  if (!found) {
    found = { id: provider.id, name: provider.name, type: provider.type, baseUrl: provider.baseUrl };
    providers.push(found);
  }
  if (apiKey) found.apiKey = apiKey;
  found.models = provider.models || [];

  if (!data.agents) data.agents = {};
  if (!data.agents.default) data.agents.default = {};
  data.agents.default.model = modelId;
  data.agents.default.provider = provider.id;

  await fs.writeFile(configPath, JSON.stringify(data, null, 2));
}

async function applyJsonAgentConfig(provider, modelId, apiKey, configPath) {
  await fs.ensureDir(path.dirname(configPath));

  let data = {};
  if (await fs.pathExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf-8');
    data = content.trim() ? JSON.parse(content) : {};
  }

  if (!data.models) data.models = {};
  if (!data.models.providers) data.models.providers = [];

  const providers = data.models.providers;
  let found = providers.find(p => p.id === provider.id);
  if (!found) {
    found = { id: provider.id, name: provider.name, type: provider.type, baseUrl: provider.baseUrl };
    providers.push(found);
  }
  if (apiKey) found.apiKey = apiKey;
  found.models = (provider.models || []).map(m => ({
    id: m.id,
    name: m.name || m.id,
    capabilities: m.capabilities || [],
  }));

  if (!data.agents) data.agents = {};
  if (!data.agents.default) data.agents.default = {};
  data.agents.default.model = modelId;
  data.agents.default.provider = provider.id;

  await fs.writeFile(configPath, JSON.stringify(data, null, 2));
}

async function applyWorkBuddyConfig(provider, modelId, apiKey) {
  const configPath = path.join(os.homedir(), '.workbuddy', 'models.json');
  await fs.ensureDir(path.dirname(configPath));

  let data = {};
  if (await fs.pathExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf-8');
    data = content.trim() ? JSON.parse(content) : {};
  }

  if (!Array.isArray(data.models)) data.models = [];

  const baseUrl = (provider.baseUrl || '').replace(/\/$/, '');
  const chatUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const model = (provider.models || []).find(m => m.id === modelId);

  let entry = data.models.find(m => m.id === modelId);
  if (!entry) {
    entry = { id: modelId, name: (model && model.name) || modelId, vendor: provider.name, url: chatUrl };
    data.models.push(entry);
  } else {
    entry.name = (model && model.name) || entry.name;
    entry.vendor = provider.name;
    entry.url = chatUrl;
  }
  if (apiKey) entry.apiKey = apiKey;

  if (!Array.isArray(data.availableModels)) data.availableModels = [];
  if (!data.availableModels.includes(modelId)) {
    data.availableModels.push(modelId);
  }

  await fs.writeFile(configPath, JSON.stringify(data, null, 2));
}

async function applyKimiCodeConfig(provider, modelId, apiKey) {
  const kimiDir = path.join(os.homedir(), '.kimi-code');
  const configPath = path.join(kimiDir, 'config.toml');
  await fs.ensureDir(kimiDir);

  let toml = '';
  if (await fs.pathExists(configPath)) {
    toml = await fs.readFile(configPath, 'utf-8');
  }

  const endpoints = provider.endpoints || [{ type: provider.type, baseUrl: provider.baseUrl }];
  const openaiEp = endpoints.find(ep => ep.type === 'openai');
  const baseUrl = openaiEp ? openaiEp.baseUrl : provider.baseUrl;
  const wireApi = openaiEp && openaiEp.protocol === 'responses' ? 'responses' : 'chat';

  const providerId = (provider.id === 'kimi-coding' || provider.id === 'moonshot') ? 'kimi' : `okit-${provider.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  // Upsert top-level keys
  toml = upsertKimiTomlKey(toml, 'model', `"${modelId}"`);
  toml = upsertKimiTomlKey(toml, 'model_provider', `"${providerId}"`);

  if (providerId !== 'kimi') {
    const envKey = `OKIT_KIMI_CODE_${provider.id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_API_KEY`;
    toml = upsertKimiTomlTable(toml, `model_providers.${providerId}`, [
      `name = "${provider.name}"`,
      `base_url = "${baseUrl}"`,
      `env_key = "${envKey}"`,
      `wire_api = "${wireApi}"`,
    ]);
    if (apiKey) await upsertKimiEnvFile(path.join(kimiDir, '.env'), envKey, apiKey);
  } else if (apiKey) {
    await upsertKimiEnvFile(path.join(kimiDir, '.env'), 'MOONSHOT_API_KEY', apiKey);
  }

  await fs.writeFile(configPath, toml);
}

// OpenCode uses a flat config.json: { provider, model, apiKey, baseUrl }.
// Mirrors the TS adapter at src/providers/adapters/opencode.ts.
async function applyOpenCodeConfig(provider, modelId, apiKey) {
  const openCodeDir = path.join(os.homedir(), '.opencode');
  const configPath = path.join(openCodeDir, 'config.json');
  await fs.ensureDir(openCodeDir);

  let data = {};
  if (await fs.pathExists(configPath)) {
    const content = await fs.readFile(configPath, 'utf-8');
    data = content.trim() ? JSON.parse(content) : {};
  }

  data.provider = provider.type;
  data.model = modelId;
  if (apiKey) data.apiKey = apiKey;
  if (provider.baseUrl) data.baseUrl = provider.baseUrl;

  await fs.writeFile(configPath, JSON.stringify(data, null, 2));
}

function upsertKimiTomlKey(toml, key, value) {
  const lines = toml.split('\n');
  let tableStart = lines.findIndex(l => l.trim().startsWith('['));
  if (tableStart === -1) tableStart = lines.length;

  for (let i = 0; i < tableStart; i++) {
    if (new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).test(lines[i])) {
      lines[i] = `${key} = ${value}`;
      return lines.join('\n');
    }
  }
  lines.splice(tableStart, 0, `${key} = ${value}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function upsertKimiTomlTable(toml, tableName, entries) {
  const header = `[${tableName}]`;
  const headerRe = new RegExp(`^\\s*\\[${tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*(?:#.*)?$`);
  const lines = toml.split('\n');
  const start = lines.findIndex(l => headerRe.test(l));

  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    while (before.length && before[before.length - 1].trim() === '') before.pop();
    while (after.length && after[0].trim() === '') after.shift();
    return [...before, ...(before.length ? [''] : []), header, ...entries, ...(after.length ? ['', ...after] : [''])].join('\n');
  }
  return `${toml.trimEnd()}\n\n${[header, ...entries].join('\n')}\n`;
}

async function upsertKimiEnvFile(envPath, key, value) {
  let content = '';
  if (await fs.pathExists(envPath)) content = await fs.readFile(envPath, 'utf-8');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `export ${key}='${value.replace(/'/g, "'\\''")}'`;
  const re = new RegExp(`^\\s*(?:export\\s+)?${escapedKey}=.*$`, 'm');
  content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  await fs.writeFile(envPath, content.trimStart());

  if (os.platform() === 'darwin') {
    const { execFile } = require('child_process');
    execFile('/bin/launchctl', ['setenv', key, value], () => {});
  }
}

async function getAuthStatus(req, res) {
  try {
    const providers = await loadProviders();
    const results = [];

    for (const p of providers) {
      const status = {
        id: p.id,
        name: p.name,
        hasApiKey: false,
        // A key is not considered authenticated until this exact provider
        // configuration has passed an explicit connection test. This also
        // makes older providers (which have no field yet) show as pending
        // verification instead of claiming a connection from mere presence.
        authVerified: p.authVerified === true,
        oauthLoggedIn: null,
        authMode: p.authMode,
      };

      // Check Vault key
      if (p.vaultKey) {
        try {
          const apiKey = await resolveVaultKey(p.vaultKey);
          status.hasApiKey = !!apiKey;
        } catch {}
      }

      // Check OAuth status for providers that support it
      if (p.authMode === 'oauth' || p.authMode === 'both') {
        status.oauthLoggedIn = await detectOAuth(p.id);
      }

      results.push(status);
    }

    res.json({ statuses: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function triggerOAuthLogin(req, res) {
  const { providerId } = req.body;
  if (!providerId) return res.status(400).json({ error: 'providerId required' });

  const os = require('os');
  const platform = os.platform();

  // Platform-specific OAuth URLs and CLI commands
  const entries = {
    anthropic: { name: 'Claude Code', url: 'https://console.anthropic.com/', cli: 'claude', cliArgs: ['login'] },
    'openai-codex': { name: 'ChatGPT', url: 'https://chatgpt.com/', cli: 'codex', cliArgs: ['auth', 'login'] },
  };

  const entry = entries[providerId];
  if (!entry) {
    return res.status(400).json({ error: `${providerId} 不支持 OAuth 登录` });
  }

  const { spawn } = require('child_process');

  // Try CLI login first (if installed), fall back to opening URL.
  // safe: cliArgs comes from the hardcoded `entries` registry above, not user input.
  // Still validate each arg is a string to defend against any unexpected mutation.
  const cliPath = findCommand(entry.cli);
  if (cliPath) {
    if (!Array.isArray(entry.cliArgs) || entry.cliArgs.some(a => typeof a !== 'string')) {
      return res.status(500).json({ error: 'invalid cliArgs' });
    }
    const child = spawn(cliPath, entry.cliArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });
    child.unref();
    child.on('error', () => {});
  }

  // Also open the platform console in browser as a fallback.
  // Validate the URL scheme before spawning to prevent injection via crafted URLs.
  const url = entry.url;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'invalid oauth url' });
  }
  const openCmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  // No shell: pass URL as a discrete argument to avoid shell interpolation.
  if (openCmd === 'start') {
    // Windows `start` requires a leading title arg; spawn directly without shell.
    spawn(openCmd, ['', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(openCmd, [url], { detached: true, stdio: 'ignore' }).unref();
  }

  res.json({ success: true, message: `已打开 ${entry.name} 控制台，完成登录后刷新状态` });
}

function findCommand(cmd) {
  // Validate command name to prevent injection: only allow alphanumerics, dash, underscore.
  if (typeof cmd !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(cmd)) return null;
  const { spawnSync } = require('child_process');
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      // No shell: pass args as array. `where` is the Windows equivalent of `which`.
      const result = spawnSync('where', [cmd], { encoding: 'utf-8', timeout: 5000 });
      const out = (result.stdout || '').trim();
      return out.split(/\r?\n/)[0] || null;
    }
    const result = spawnSync('which', [cmd], { encoding: 'utf-8', timeout: 5000 });
    const out = (result.stdout || '').trim();
    return out || null;
  } catch {
    return null;
  }
}

async function detectOAuth(providerId) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const home = os.homedir();

  try {
    switch (providerId) {
      case 'anthropic': {
        const credPath = path.join(home, '.claude', '.credentials.json');
        if (!fs.existsSync(credPath)) return false;
        const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        return !!(data.claudeApiKey || data.accessToken || data.apiKey);
      }
      case 'openai':
      case 'openai-codex': {
        const authPath = path.join(home, '.codex', 'auth.json');
        if (!fs.existsSync(authPath)) return false;
        const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        return !!(data.tokens?.access_token);
      }
      case 'google': {
        // No shell: pass args as a discrete array. stderr is ignored via stdio config.
        const { spawnSync } = require('child_process');
        const result = spawnSync('gcloud', ['auth', 'list', '--format=json'], {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (result.status !== 0 || !result.stdout) return false;
        const accounts = JSON.parse(result.stdout);
        return Array.isArray(accounts) && accounts.some(a => a.status === 'ACTIVE');
      }
      default:
        return null;
    }
  } catch {
    return false;
  }
}

async function fetchModels(req, res) {
  const { providerId, endpoints: requestedEndpoints, vaultKey: requestedVaultKey } = req.body;
  const previewConfig = Array.isArray(requestedEndpoints) || Object.prototype.hasOwnProperty.call(req.body, 'vaultKey');
  if (!providerId && !previewConfig) return res.status(400).json({ error: 'providerId required' });

  try {
    const providers = await loadProviders();
    const p = providerId ? providers.find(x => x.id === providerId) : undefined;
    if (!p && !previewConfig) return res.status(404).json({ error: 'Provider 不存在' });

    const apiKey = previewConfig
      ? (requestedVaultKey ? await resolveVaultKey(requestedVaultKey) : undefined)
      : (p?.vaultKey ? await resolveVaultKey(p.vaultKey) : undefined);
    const endpoints = Array.isArray(requestedEndpoints) && requestedEndpoints.length
      ? requestedEndpoints
      : (p?.endpoints || (p ? [{ type: p.type, baseUrl: p.baseUrl }] : []));
    if (!endpoints.length) return res.status(400).json({ error: '至少需要一个有效端点' });
    const allModels = [];
    const errors = [];

    for (const ep of endpoints) {
      try {
        let models = [];
        if (ep.type === 'openai') {
          models = isQianfanCodingEndpoint(ep.baseUrl)
            ? await fetchQianfanCodingModels(ep.baseUrl, apiKey)
            : await fetchOpenAIModels(ep.baseUrl, apiKey);
        } else if (ep.type === 'google') {
          models = await fetchGoogleModels(ep.baseUrl, apiKey);
        } else if (ep.type === 'anthropic') {
          models = await fetchAnthropicModels(ep.baseUrl, apiKey);
        }
        for (const m of models) {
          if (!allModels.find(x => x.id === m.id)) allModels.push(m);
        }
      } catch (err) {
        errors.push({ endpoint: ep.baseUrl, error: err.message });
      }
    }

    if (allModels.length > 0 && p && !previewConfig) {
      // Update provider with fetched models
      p.models = allModels.map(m => ({ id: m.id, name: m.name || m.id }));
      const data = { providers, version: 1 };
      await backupImportantData('providers');
      await fs.writeFile(PROVIDERS_PATH, JSON.stringify(data, null, 2));
    }

    res.json({
      success: allModels.length > 0,
      models: allModels,
      errors: errors.length > 0 ? errors : undefined,
      kept: allModels.length === 0 && p ? p.models : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function fetchOpenAIModels(baseUrl, apiKey) {
  const url = baseUrl.replace(/\/+$/, '') + '/models';
  const headers = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const result = await httpReq(url, { method: 'GET', headers, timeout: 10000 });
  if (result.error) throw new Error(result.error);
  if (result.status === 200) {
    const d = JSON.parse(result.body);
    const models = (d.data || []).map(m => ({ id: m.id, name: m.id }));
    if (models.length) return models;
  }
  // Some deployments return 200 with an empty list, or 404/403/405 when the
  // /models endpoint is not exposed. For Coding Plan providers we probe the
  // chat endpoint with a plan-specific model and return the known fallback
  // list on success so the UI shows usable models instead of "sync failed".
  const fallback = getFallbackModels(baseUrl);
  if (fallback && (result.status === 200 || result.status === 404 || result.status === 403 || result.status === 405)) {
    const probeModel = pickProbeModel(baseUrl);
    const probeBody = JSON.stringify({
      model: probeModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
    const probeResult = await httpReq(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers, body: probeBody, timeout: 10000,
    });
    if (probeResult.error) throw new Error(probeResult.error);
    // 200 or 400 (bad request for max_tokens=1 etc.) both mean the key is
    // valid and the endpoint is reachable — return the known model list.
    if (probeResult.status === 200 || probeResult.status === 400) return fallback;
    if (probeResult.status === 401) throw new Error('API Key 无效');
    throw new Error(`HTTP ${probeResult.status}`);
  }
  if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
  return [];
}

async function fetchQianfanCodingModels(baseUrl, apiKey) {
  const root = baseUrl.replace(/\/+$/, '');
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const listResult = await httpReq(`${root}/models`, { method: 'GET', headers, timeout: 10000 });
  if (listResult.error) throw new Error(listResult.error);

  const listCode = qianfanCodingErrorCode(listResult.body);
  const listMessage = qianfanCodingErrorMessage(listCode);
  if (listMessage) throw new Error(listMessage);
  if (listResult.status === 200) {
    const data = JSON.parse(listResult.body);
    const models = (data.data || []).map(m => ({ id: m.id, name: m.id }));
    if (models.length) return models;
  }

  // The Coding Plan documentation guarantees the chat route and model names,
  // but some deployments do not expose /models. Validate the key with the
  // documented model and use the known list only after the probe succeeds.
  if (listResult.status === 404 || listResult.status === 405 || listResult.status === 200) {
    const probeBody = JSON.stringify({
      model: 'qianfan-code-latest',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
    const probeResult = await httpReq(`${root}/chat/completions`, {
      method: 'POST', headers, body: probeBody, timeout: 10000,
    });
    if (probeResult.error) throw new Error(probeResult.error);
    const probeCode = qianfanCodingErrorCode(probeResult.body);
    const probeMessage = qianfanCodingErrorMessage(probeCode);
    if (probeMessage) throw new Error(probeMessage);
    if (probeResult.status === 200 || probeResult.status === 400) return qianfanCodingModels();
    if (probeResult.status === 401) throw new Error('百度千帆 Coding Plan API Key 无效');
    throw new Error(`HTTP ${probeResult.status}`);
  }

  if (listResult.status === 401) throw new Error('百度千帆 Coding Plan API Key 无效');
  throw new Error(`HTTP ${listResult.status}`);
}

async function fetchGoogleModels(baseUrl, apiKey) {
  const url = `${baseUrl}/v1beta/models${apiKey ? '?key=' + apiKey : ''}`;
  const result = await httpReq(url, { method: 'GET', timeout: 10000 });
  if (result.error) throw new Error(result.error);
  if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
  const d = JSON.parse(result.body);
  return (d.models || []).map(m => {
    const id = m.name?.replace('models/', '') || m.name;
    return { id, name: m.displayName || id };
  });
}

async function fetchAnthropicModels(baseUrl, apiKey) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}/v1/models`;
  const headers = {};
  if (/^https?:\/\/api\.z\.ai\/api\/anthropic\/?$/i.test(String(baseUrl || '').trim())) {
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    headers['accept-language'] = 'en-US,en';
  } else if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  headers['anthropic-version'] = '2023-06-01';
  const result = await httpReq(url, { method: 'GET', headers, timeout: 10000 });
  if (result.error) throw new Error(result.error);
  if (result.status === 404 || result.status === 405) throw new Error('不支持模型列表接口');
  if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
  const d = JSON.parse(result.body);
  return (d.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
}

function httpReq(url, options) {
  return new Promise((resolve) => {
    const parsed = new (require('url').URL)(url);
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(url, options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', err => resolve({ status: 0, error: err.message }));
    if (options.body) req.write(options.body);
    req.setTimeout(options.timeout || 10000, () => { req.destroy(); resolve({ status: 0, error: 'Timeout' }); });
    req.end();
  });
}

module.exports = {
  listProviders,
  getAdaptersList,
  createProvider,
  updateProvider,
  deleteProvider: deleteProviderRoute,
  switchProvider,
  launchAgent,
  getAuthStatus,
  triggerOAuthLogin,
  fetchModels,
};
