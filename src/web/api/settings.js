const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.okit', 'user.json');
const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

function appendLog(action, name, success, detail) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      name,
      action,
      success,
      duration: 0,
    };
    if (detail) entry.output = detail;
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

const SENSITIVE_KEYS = ['accessKeySecret', 'password'];

async function loadConfig() {
  try {
    if (!(await fs.pathExists(CONFIG_PATH))) return {};
    return await fs.readJson(CONFIG_PATH);
  } catch { return {}; }
}

async function saveConfig(config) {
  await fs.ensureDir(path.dirname(CONFIG_PATH));
  await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
}

function maskConfig(sync) {
  if (!sync) return sync;
  const masked = JSON.parse(JSON.stringify(sync));
  if (masked.password) masked.password = '***';
  if (!masked.platforms) return masked;
  for (const [, plat] of Object.entries(masked.platforms)) {
    for (const key of SENSITIVE_KEYS) {
      if (plat[key] && plat[key].length > 0) {
        plat[key] = '***';
      }
    }
  }
  return masked;
}

function mergeSensitive(current, patch) {
  if (!patch || !current) return patch || current;
  const merged = { ...patch };
  // Merge sync-level sensitive fields
  if (merged.password === '***' && current.password) {
    merged.password = current.password;
  }
  for (const [platName, platConfig] of Object.entries(merged.platforms || {})) {
    if (!platConfig || !current.platforms?.[platName]) continue;
    for (const key of SENSITIVE_KEYS) {
      if (platConfig[key] === '***' && current.platforms[platName][key]) {
        platConfig[key] = current.platforms[platName][key];
      }
    }
  }
  return merged;
}

function getDefaultAgentConfig() {
  return {
    provider: 'siliconflow',
    model: 'deepseek-ai/DeepSeek-V3',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyVaultKey: 'SILICONFLOW_API_KEY',
  };
}

async function getSettings(req, res) {
  try {
    const config = await loadConfig();
    const sync = config.sync || { autoSync: false, platforms: {} };
    const agent = config.agent || getDefaultAgentConfig();
    res.json({ sync: maskConfig(sync), agent });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load settings' });
  }
}

async function updateSettings(req, res) {
  try {
    const { sync, agent } = req.body;
    if (!sync && !agent) return res.status(400).json({ error: 'sync or agent is required' });

    const config = await loadConfig();

    if (sync) {
      const merged = mergeSensitive(config.sync, sync);
      config.sync = {
        ...config.sync,
        ...merged,
        platforms: {
          ...config.sync?.platforms,
          ...merged.platforms,
        },
      };
    }

    if (agent) {
      config.agent = { ...getDefaultAgentConfig(), ...(config.agent || {}), ...agent };
    }

    await saveConfig(config);
    const changes = [];
    if (sync) changes.push(...Object.keys(sync.platforms || {}));
    if (agent) changes.push('agent');
    appendLog('settings-update', changes.join(',') || 'settings', true);
    res.json({ success: true, sync: maskConfig(config.sync), agent: config.agent });
  } catch (error) {
    console.error('Error updating settings:', error);
    appendLog('settings-update', 'settings', false, error.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
}

const SECRET_FIELD_PATTERNS = /ecret|oken|Key|Id$/;
const SKIP_FIELDS = /storeId|databaseId|bucketName|region/i;

const VAULT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;

async function resolveVaultRefs(platConfig) {
  const { VaultStore } = require('../../vault/store');
  const store = new VaultStore();
  const resolved = { ...platConfig };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && SECRET_FIELD_PATTERNS.test(key) && !SKIP_FIELDS.test(key)) {
      if (!VAULT_KEY_PATTERN.test(value)) continue;
      let actual = await store.get(value);
      if (!actual) {
        const aliases = await store.getAliases(value);
        if (aliases.length > 0) actual = await store.get(value + '/' + aliases[0]);
      }
      if (!actual) throw new Error(`密钥 "${value}" 不存在，请先在密钥管理中添加`);
      resolved[key] = actual;
    }
  }
  return resolved;
}

async function testPlatformConnection(req, res) {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform is required' });
  try {
    const core = require('./cloud-sync-core');
    const result = await core.testConnection(platform);
    res.json({ success: true, message: result });
  } catch (error) {
    appendLog('platform-test', platform, false, error.message);
    res.json({ success: false, message: error.message });
  }
}

const PRESETS = [
  {
    id: 'claude-starter',
    name: 'Claude 全家桶',
    desc: '一键配齐 Claude Code，开始用 AI 写代码、写文案',
    icon: '✦',
    color: '#d97706',
    tools: ['claude-code'],
    requiredKeys: [
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', hint: '从 console.anthropic.com 获取' },
    ],
  },
  {
    id: 'ai-creative',
    name: 'AI 创意工坊',
    desc: 'Cursor + Claude 双工具，多种 AI 任你选',
    icon: '◆',
    color: '#7c3aed',
    tools: ['claude-code', 'cursor'],
    requiredKeys: [
      { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', hint: '从 platform.openai.com 获取' },
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', hint: '从 console.anthropic.com 获取' },
    ],
  },
  {
    id: 'ai-automation',
    name: 'AI 自动化',
    desc: 'Claude Code + Codex，让 AI 自动跑任务',
    icon: '⚡',
    color: '#0891b2',
    tools: ['claude-code', 'codex'],
    requiredKeys: [
      { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', hint: '从 platform.openai.com 获取' },
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', hint: '从 console.anthropic.com 获取' },
    ],
  },
];

async function getPresets(req, res) {
  res.json({ presets: PRESETS });
}

async function getOnboarding(req, res) {
  try {
    const config = await loadConfig();
    const done = !!config.hints?.onboardingDone;
    res.json({ done });
  } catch {
    res.json({ done: false });
  }
}

async function dismissOnboarding(req, res) {
  try {
    const config = await loadConfig();
    if (!config.hints) config.hints = {};
    config.hints.onboardingDone = true;
    await saveConfig(config);
    appendLog('onboarding-dismiss', 'onboarding', true);
    res.json({ success: true });
  } catch (error) {
    appendLog('onboarding-dismiss', 'onboarding', false, error.message);
    res.status(500).json({ error: 'Failed to dismiss onboarding' });
  }
}

async function resetOnboarding(req, res) {
  try {
    const config = await loadConfig();
    if (config.hints) delete config.hints.onboardingDone;
    await saveConfig(config);
    appendLog('onboarding-reset', 'onboarding', true);
    res.json({ success: true });
  } catch (error) {
    appendLog('onboarding-reset', 'onboarding', false, error.message);
    res.status(500).json({ error: 'Failed to reset onboarding' });
  }
}

async function testAgentConnection(req, res) {
  const config = await loadConfig();
  const agentConfig = { ...getDefaultAgentConfig(), ...(config.agent || {}) };

  try {
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    const apiKey = await store.get(agentConfig.apiKeyVaultKey);
    if (!apiKey) {
      return res.json({ success: false, message: `请先在密钥管理中添加 ${agentConfig.apiKeyVaultKey}` });
    }

    const { createOpenAI } = require('@ai-sdk/openai');
    const { generateText } = require('ai');
    const aiProvider = createOpenAI({ baseURL: agentConfig.baseUrl, apiKey });

    await generateText({
      model: aiProvider.chat(agentConfig.model),
      prompt: 'say ok',
      maxTokens: 5,
    });

    res.json({ success: true, message: `连接成功 (${agentConfig.model})` });
  } catch (error) {
    res.json({ success: false, message: error.message?.substring(0, 200) || '连接失败' });
  }
}

async function syncSecretsToPlatform(req, res) {
  const { platform, keys } = req.body;
  if (!platform || !Array.isArray(keys)) return res.status(400).json({ error: 'platform and keys are required' });
  try {
    const core = require('./cloud-sync-core');
    const results = await core.pushSecrets(platform, keys);
    res.json({ success: true, results });
  } catch (error) {
    appendLog('cloud-push', platform, false, error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getSettings, updateSettings, testPlatformConnection, testAgentConnection, syncSecretsToPlatform, getPresets, getOnboarding, dismissOnboarding, resetOnboarding };
