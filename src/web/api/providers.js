const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const OKIT_DIR = path.join(os.homedir(), '.okit');
const PROVIDERS_PATH = path.join(OKIT_DIR, 'providers.json');
const USER_CONFIG_PATH = path.join(OKIT_DIR, 'user.json');

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
    authMode: "both",
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
    name: "OpenAI Codex",
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
    name: "Moonshot (Kimi)",
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
    name: "Kimi Coding",
    type: "openai",
    baseUrl: "https://api.kimi.com",
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
    endpoints: [
      { type: "openai", baseUrl: "https://qianfan.baidubce.com/v2" },
      { type: "openai", baseUrl: "https://qianfan.baidubce.com/v2/coding" },
    ],
    authMode: "api_key",
    models: [
      { id: "ernie-4.5-8k-preview", name: "ERNIE 4.5" },
      { id: "ernie-4.0-8k", name: "ERNIE 4.0" },
      { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
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
    id: "groq",
    name: "Groq",
    type: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    authMode: "api_key",
    models: [
      { id: "gpt-oss", name: "GPT OSS" },
      { id: "kimi-k2", name: "Kimi K2" },
      { id: "qwen3-32b", name: "Qwen3 32B" },
      { id: "llama-3-groq-70b-tool-use", name: "Llama 3 70B Tool Use" },
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    type: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    authMode: "api_key",
    models: [
      { id: "accounts/fireworks/models/qwen3-235b", name: "Qwen3 235B" },
      { id: "accounts/fireworks/models/llama4-maverick", name: "Llama 4 Maverick" },
      { id: "accounts/fireworks/models/deepseek-r1", name: "DeepSeek R1" },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    type: "openai",
    baseUrl: "https://api.together.xyz/v1",
    authMode: "api_key",
    models: [
      { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct", name: "Llama 4 Maverick" },
      { id: "deepseek-ai/DeepSeek-V4", name: "DeepSeek V4" },
      { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B" },
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
    const providers = Array.isArray(data.providers) ? data.providers : [];

    // Merge new presets: add missing ones, update name changes
    let changed = false;
    for (const preset of PRESET_PROVIDERS) {
      const existing = providers.find(p => p.id === preset.id);
      if (!existing) {
        providers.push(preset);
        changed = true;
      } else if (existing.name !== preset.name) {
        existing.name = preset.name;
        changed = true;
      }
    }
    if (changed) await saveProviders(providers);

    return providers;
  } catch { return []; }
}

async function saveProviders(providers) {
  await fs.ensureDir(OKIT_DIR);
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
  await fs.writeFile(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
}

const ADAPTERS = [
  { id: 'claude', name: 'Claude Code', supportedTypes: ['anthropic'] },
  { id: 'codex', name: 'Codex CLI', supportedTypes: ['openai'] },
  { id: 'gemini', name: 'Gemini CLI', supportedTypes: ['google'] },
  { id: 'opencode', name: 'OpenCode', supportedTypes: ['anthropic', 'openai', 'google'] },
  { id: 'openclaw', name: 'OpenClaw', supportedTypes: ['anthropic', 'openai', 'google'] },
];

async function listProviders(req, res) {
  try {
    const providers = await loadProviders();
    const config = await loadUserConfig();
    const providersConfig = config.providers || {};

    // Attach current selection info
    const result = providers.map(p => {
      const providerTypes = p.endpoints?.map(e => e.type) || [p.type];
      return {
        ...p,
        usedBy: ADAPTERS
          .filter(a => providerTypes.some(t => a.supportedTypes.includes(t)) && providersConfig[a.id]?.providerId === p.id)
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
      const compatible = providers.filter(p => adapter.supportedTypes.includes(p.type));

      return {
        ...adapter,
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

async function createProvider(req, res) {
  try {
    const providers = await loadProviders();
    const { id, name, type, baseUrl, endpoints, vaultKey, authMode, models } = req.body;

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

    if (!adapter.supportedTypes.includes(provider.type)) {
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
    default:
      break;
  }
}

async function resolveVaultKey(vaultKey) {
  try {
    const store = require('../../vault/store').VaultStore;
    const instance = new store();
    return await instance.resolve(vaultKey);
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

  await fs.ensureDir(codexDir);
  let toml = '';
  if (await fs.pathExists(configPath)) {
    toml = await fs.readFile(configPath, 'utf-8');
  }

  const modelRegex = /^model\s*=\s*.*$/m;
  const modelLine = `model = "${modelId}"`;
  toml = modelRegex.test(toml) ? toml.replace(modelRegex, modelLine) : toml.trimEnd() + '\n' + modelLine + '\n';

  await fs.writeFile(configPath, toml);

  if (apiKey) {
    await fs.writeFile(path.join(codexDir, '.env'), `OPENAI_API_KEY=${apiKey}\n`);
  }
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

async function getAuthStatus(req, res) {
  try {
    const providers = await loadProviders();
    const results = [];

    for (const p of providers) {
      const status = { id: p.id, name: p.name, hasApiKey: false, oauthLoggedIn: null, authMode: p.authMode };

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
    'openai-codex': { name: 'Codex CLI', url: 'https://chatgpt.com/', cli: 'codex', cliArgs: ['auth', 'login'] },
  };

  const entry = entries[providerId];
  if (!entry) {
    return res.status(400).json({ error: `${providerId} 不支持 OAuth 登录` });
  }

  const { exec, spawn } = require('child_process');

  // Try CLI login first (if installed), fall back to opening URL
  const cliPath = findCommand(entry.cli);
  if (cliPath) {
    const child = spawn(cliPath, entry.cliArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });
    child.unref();
    child.on('error', () => {});
  }

  // Also open the platform console in browser as a fallback
  const openCmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${entry.url}"`, (err) => {
    if (err) console.log(`[oauth] open URL failed: ${err.message}`);
  });

  res.json({ success: true, message: `已打开 ${entry.name} 控制台，完成登录后刷新状态` });
}

function findCommand(cmd) {
  const { execSync } = require('child_process');
  try {
    const path = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, { encoding: 'utf-8' }).trim();
    return path || null;
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
        const { execSync } = require('child_process');
        const out = execSync('gcloud auth list --format=json 2>/dev/null || echo "[]"', { encoding: 'utf-8', timeout: 5000 });
        const accounts = JSON.parse(out);
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
  const { providerId } = req.body;
  if (!providerId) return res.status(400).json({ error: 'providerId required' });

  try {
    const providers = await loadProviders();
    const p = providers.find(x => x.id === providerId);
    if (!p) return res.status(404).json({ error: 'Provider 不存在' });

    const apiKey = p.vaultKey ? await resolveVaultKey(p.vaultKey) : undefined;
    const endpoints = p.endpoints || [{ type: p.type, baseUrl: p.baseUrl }];
    const allModels = [];
    const errors = [];

    for (const ep of endpoints) {
      try {
        let models = [];
        if (ep.type === 'openai') {
          models = await fetchOpenAIModels(ep.baseUrl, apiKey);
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

    if (allModels.length > 0) {
      // Update provider with fetched models
      p.models = allModels.map(m => ({ id: m.id, name: m.name || m.id }));
      const data = { providers, version: 1 };
      await fs.writeFile(PROVIDERS_PATH, JSON.stringify(data, null, 2));
    }

    res.json({
      success: allModels.length > 0,
      models: allModels,
      errors: errors.length > 0 ? errors : undefined,
      kept: allModels.length === 0 ? p.models : undefined,
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
  if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
  const d = JSON.parse(result.body);
  return (d.data || []).map(m => ({ id: m.id, name: m.id }));
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
  const url = `${baseUrl}/v1/models`;
  const headers = {};
  if (apiKey) headers['x-api-key'] = apiKey;
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
  getAuthStatus,
  triggerOAuthLogin,
  fetchModels,
};
