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

// Sort models by "capability descending": higher version first, then size tier.
// Extracts version tuples (5.6 > 5.5 > 4.7) and size tiers from the id so
// models display high→low regardless of the provider API return order.
// Within the SAME version, "lite" variants (flash/mini/haiku) sort AFTER the
// standard model — flash is a cheaper tier, not a higher one.
function sortModels(models) {
  // Higher rank = more capable. 0 = standard (no tier word found).
  const sizeRank = { opus: 4, pro: 3, sonnet: 2, haiku: 1, flash: -1, mini: -2, nano: -3, micro: -3, lite: -3, turbo: -1 };
  const extractKey = (id) => {
    const lower = id.toLowerCase();
    const verMatch = lower.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    const ver = verMatch ? [parseInt(verMatch[1]) || 0, parseInt(verMatch[2]) || 0, parseInt(verMatch[3]) || 0] : [0, 0, 0];
    let size = 0;
    for (const [word, rank] of Object.entries(sizeRank)) {
      if (lower.includes(word)) { size = rank; break; }
    }
    return { ver, size, name: lower };
  };
  return [...models].sort((a, b) => {
    const ka = extractKey(a.id);
    const kb = extractKey(b.id);
    for (let i = 0; i < 3; i++) {
      if (ka.ver[i] !== kb.ver[i]) return kb.ver[i] - ka.ver[i];
    }
    if (ka.size !== kb.size) return kb.size - ka.size;
    return ka.name.localeCompare(kb.name);
  });
}

// Tag each model with `recent: true/false` so the frontend can default-hide
// stale / non-coding models while still letting users add them back from the
// "add models" picker. We do NOT delete them from the list — the picker needs
// the full set to restore hidden entries.
//
// Rules for `recent: false` (hidden by default):
// 1. Non-text-LLM model types (embedding/vision/audio/tts/3d/image/video/
//    character/seedream/seedance/seededit/hitem/wan) → not coding-capable.
// 2. Dated snapshots with YYMMDD suffix < 260000 (before 2026) → stale.
function tagRecentModels(models) {
  const DATE_RE = /(\d{6})$/;
  const NON_CODING_RE = /embed|vision|audio|tts|asr|3d|image|video|character|seedream|seedance|seededit|hitem|^wan|ui-tars|voice|speak|realtime|terminus|distill|preview|-7b-|-14b-|-32b-|-72b-|-6b-|-8b-/i;
  return models.map(m => {
    let recent = true;
    if (NON_CODING_RE.test(m.id)) recent = false;
    const match = m.id.match(DATE_RE);
    if (match && parseInt(match[1]) < 260000) recent = false;
    return { ...m, recent };
  });
}

// Sort providers alphabetically by display name. Uses localeCompare with
// zh-Hans-CN so Chinese names sort by pinyin, English names sort A-Z, and
// mixed lists interleave naturally. Official/subscription presets (anthropic,
// openai-codex, google-agent, anthropic-agent) are pinned to the top so they
// don't get buried under Chinese-named third-party providers.
// Sort all providers alphabetically by display name. Chinese names sort by
// pinyin (zh-Hans-CN), English names sort A-Z, mixed lists interleave.
function sortProviders(arr) {
  return [...arr].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id, 'zh-Hans-CN')
  );
}

// Single source of truth: import presets + metadata from the compiled TS
// output. This eliminates the hand-maintained JS copy of 28 provider presets.
// Try dist/ first (production), then fall back to src compiled output.
let _presets, _metadata;
let _platforms;
try {
  _presets = require('../../../providers/presets');
  _metadata = require('../../../providers/metadata');
  _platforms = require('../../../providers/platforms');
} catch {
  // Fallback for dev mode where dist/ may not be in the expected relative position
  _presets = require('../../../dist/providers/presets');
  _metadata = require('../../../dist/providers/metadata');
  _platforms = require('../../../dist/providers/platforms');
}

// Single adapter registry (shared with the CLI). Required once at module load
// so test suites can mock '../../dist/providers/registry' reliably — the old
// lazy require inside switchProvider escaped vitest's module interception.
let _getAdapter;
try {
  _getAdapter = require('../../../providers/registry').getAdapter;
} catch {
  _getAdapter = require('../../../dist/providers/registry').getAdapter;
}

const PRESET_PROVIDERS = _presets.PRESET_PROVIDERS;
const buildPlatforms = _platforms.buildPlatforms;
const RETIRED_PRESET_PROVIDER_IDS = _metadata.RETIRED_PRESET_PROVIDER_IDS;
const PRESET_BASE_URL_MIGRATIONS = _metadata.PRESET_BASE_URL_MIGRATIONS;
const PRESET_ENDPOINT_BASE_URL_MIGRATIONS = _metadata.PRESET_ENDPOINT_BASE_URL_MIGRATIONS;
const PRESET_AUTH_MODE_MIGRATIONS = _metadata.PRESET_AUTH_MODE_MIGRATIONS;
const PRESET_ENDPOINT_PLAN_MIGRATIONS = new Map([
  ['opencode-go', { from: ['go', 'agent'], to: 'coding' }],
  ['qianfan-coding', { from: ['coding'], to: 'token' }],
]);

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
    const codexProvider = providers.find(p => p.id === 'openai-codex');
    if (codexProvider) {
      try {
        const cachedModels = await readCodexCachedModels();
        if (cachedModels.length > 0) codexProvider.models = cachedModels;
      } catch {
        // Keep the persisted list until Codex has produced a local model cache.
      }
    }

    // Merge new presets: add missing ones, update name changes, and apply
    // narrowly-scoped endpoint migrations for known broken built-in defaults.
    let changed = providers.length !== sourceProviders.length;
    // Strip cliOnly from all stored providers — this flag was used to hide
    // the Claude subscription preset, but it should be visible in Claude Code.
    for (const p of providers) {
      if (p.cliOnly !== undefined) { delete p.cliOnly; changed = true; }
    }
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
        const planMigration = PRESET_ENDPOINT_PLAN_MIGRATIONS.get(preset.id);
        if (planMigration && Array.isArray(existing.endpoints)) {
          let endpointChanged = false;
          existing.endpoints = existing.endpoints.map(endpoint => {
            if (endpoint?.plan && planMigration.from.includes(endpoint.plan)) {
              endpointChanged = true;
              return { ...endpoint, plan: planMigration.to };
            }
            return endpoint;
          });
          if (endpointChanged) changed = true;
        }
        const authModeMigration = PRESET_AUTH_MODE_MIGRATIONS.get(preset.id);
        if (authModeMigration && existing.authMode === authModeMigration.from) {
          existing.authMode = authModeMigration.to;
          changed = true;
        }
        // Sync endpoints that exist in the preset but are missing from the
        // stored provider (e.g. a newly-declared anthropic endpoint added
        // after providers.json was first initialized). Only ADDS missing
        // endpoint types — never overwrites user edits.
        if (Array.isArray(preset.endpoints)) {
          const existingTypes = new Set((existing.endpoints || []).map(e => e.type));
          for (const presetEp of preset.endpoints) {
            if (presetEp && !existingTypes.has(presetEp.type)) {
              existing.endpoints = [...(existing.endpoints || []), presetEp];
              changed = true;
            }
          }
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
  await fs.writeFile(PROVIDERS_PATH, JSON.stringify({ providers, platforms: buildPlatforms(providers) }, null, 2));
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
  { id: 'codex', name: 'ChatGPT', supportedTypes: ['openai'], command: 'codex', launchType: 'cli' },
  { id: 'gemini', name: 'Gemini', supportedTypes: ['google'], command: 'gemini', launchType: 'cli' },
  { id: 'opencode', name: 'OpenCode', supportedTypes: ['anthropic', 'openai', 'google'], command: 'opencode', launchType: 'cli' },
  { id: 'openclaw', name: 'OpenClaw', supportedTypes: ['anthropic', 'openai', 'google'], command: 'openclaw', launchType: 'cli' },
  { id: 'workbuddy', name: 'WorkBuddy', supportedTypes: ['anthropic', 'openai', 'google'], command: 'workbuddy', launchType: 'app', appName: 'WorkBuddy' },
  { id: 'zcode', name: 'ZCode', supportedTypes: ['anthropic', 'openai', 'google'], command: 'zcode', launchType: 'app', appName: 'ZCode' },
  { id: 'hermes', name: 'Hermes', supportedTypes: ['anthropic', 'openai', 'google'], command: 'hermes', launchType: 'cli' },
  { id: 'kimi-code', name: 'Kimi Code', supportedTypes: ['openai'], command: 'kimi', launchType: 'cli' },
];

// Caps for the goal-③ "常用模型" lists. Favorites are user-curated; recents
// are auto-recorded on each successful switch.
const FAVORITE_MODELS_MAX = 20;
const RECENT_MODELS_MAX = 10;

function adapterSupportsProvider(adapter, provider) {
  if (provider.cliOnly) return false;
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
        models: sortModels(p.models || []),
        usedBy: ADAPTERS
          .filter(a => adapterSupportsProvider(a, p) && providersConfig[a.id]?.providerId === p.id)
          .map(a => ({ id: a.id, name: a.name, modelId: providersConfig[a.id]?.modelId })),
      };
    });

    const sortedResult = sortProviders(result);
    res.json({ providers: sortedResult, platforms: buildPlatforms(sortedResult) });
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
      // All type-compatible providers that are configured (have a key / verified /
      // oauth-eligible). These are candidates for the "add to home" picker.
      const isProviderReady = (p) => {
        if (sel?.providerId === p.id) return true;
        if (p.authVerified) return true;
        if (p.vaultKey) return true;
        if (p.authMode === 'oauth' || p.authMode === 'both') return true;
        return false;
      };
      const allCompatible = providers.filter(p => adapterSupportsProvider(adapter, p) && isProviderReady(p));

      // The home list is user-curated: only provider ids the user explicitly
      // added via addHomeProvider. Empty/absent = render nothing (the user adds
      // their own from the "+ 添加" button).
      const homeIds = Array.isArray(config.homeProviders?.[adapter.id]) ? config.homeProviders[adapter.id] : [];
      const homeSet = new Set(homeIds);
      const homeProviders = allCompatible.filter(p => homeSet.has(p.id));

      return {
        ...adapter,
        launchType: adapter.launchType || 'cli',
        canLaunch: !!adapter.command,
        installed: adapter.launchType === 'app' ? true : (adapter.command ? !!findCommand(adapter.command) : false),
        current: sel?.providerId && sel?.modelId
          ? { providerId: sel.providerId, providerName: currentProvider?.name || sel.providerId, modelId: sel.modelId }
          : null,
        // Providers shown on the home page (user-curated subset), sorted.
        compatibleProviders: sortProviders(homeProviders).map(p => ({
          id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl,
          models: tagRecentModels(sortModels(p.models || [])),
        })),
        // All configured-and-compatible providers, for the "+ 添加" picker.
        // Excludes the official subscription presets (anthropic-agent /
        // openai-codex / google-agent) — those are the built-in fallback for
        // single-type agents and don't need to be added manually. Sorted.
        availableProviders: sortProviders(allCompatible
          .filter(p => !['anthropic-agent', 'openai-codex', 'google-agent'].includes(p.id))
        ).map(p => ({
            id: p.id, name: p.name, type: p.type,
            added: homeSet.has(p.id),
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

    // Apply config to agent via the TS adapter registry (single source of truth,
    // shared with the CLI). The JS writer functions that used to live here were
    // deleted — they had drifted from the TS adapters (Codex api_base bug, Gemini
    // dropping the model, etc.) and were untested.
    const agentAdapter = _getAdapter(agentId);
    if (!agentAdapter) return res.status(404).json({ error: `Adapter not implemented: ${agentId}` });
    await agentAdapter.applyConfig(provider, modelId);

    // Save selection
    const config = await loadUserConfig();
    if (!config.providers) config.providers = {};
    config.providers[agentId] = { providerId, modelId };

    // For Claude, also update legacy path
    if (agentId === 'claude') {
      config.claude = { ...config.claude, name: provider.name, model: modelId };
    }

    // Goal ③: auto-record this switch in recentModels (prepend, dedupe by
    // providerId+modelId, cap at RECENT_MODELS_MAX). Favorites are separate —
    // they are only ever mutated by the explicit favorite endpoints below.
    const entry = { providerId, modelId, agentId, lastUsedAt: new Date().toISOString() };
    const recent = Array.isArray(config.recentModels) ? config.recentModels : [];
    config.recentModels = [
      entry,
      ...recent.filter(m => !(m.providerId === providerId && m.modelId === modelId)),
    ].slice(0, RECENT_MODELS_MAX);

    await saveUserConfig(config);

    res.json({ success: true, agentId, providerId, modelId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Goal ③: favorite / recent model endpoints -----------------------------
//
// Favorites are user-curated (explicit star). Recents are auto-recorded by
// switchProvider. Both are surfaced in pickers and the home dashboard. The
// list lives in user.json alongside config.providers.

async function addFavoriteModel(req, res) {
  try {
    const { providerId, modelId } = req.body;
    if (!providerId || !modelId) {
      return res.status(400).json({ error: 'Missing required fields: providerId, modelId' });
    }
    const config = await loadUserConfig();
    const favorites = Array.isArray(config.favoriteModels) ? config.favoriteModels : [];
    // Dedupe by providerId+modelId; if already present, keep existing addedAt.
    if (favorites.some(m => m.providerId === providerId && m.modelId === modelId)) {
      return res.json({ success: true, favorites });
    }
    favorites.push({ providerId, modelId, addedAt: new Date().toISOString() });
    config.favoriteModels = favorites.slice(-FAVORITE_MODELS_MAX);
    await saveUserConfig(config);
    res.json({ success: true, favorites: config.favoriteModels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function removeFavoriteModel(req, res) {
  try {
    const { providerId, modelId } = req.params;
    if (!providerId || !modelId) {
      return res.status(400).json({ error: 'Missing providerId or modelId in path' });
    }
    const config = await loadUserConfig();
    const favorites = Array.isArray(config.favoriteModels) ? config.favoriteModels : [];
    config.favoriteModels = favorites.filter(
      m => !(m.providerId === providerId && m.modelId === modelId),
    );
    await saveUserConfig(config);
    res.json({ success: true, favorites: config.favoriteModels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getFavoriteModels(_req, res) {
  try {
    const config = await loadUserConfig();
    res.json({
      favorites: Array.isArray(config.favoriteModels) ? config.favoriteModels : [],
      recent: Array.isArray(config.recentModels) ? config.recentModels : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Home-page provider list (curated per agent) ---------------------------
//
// The home page only shows providers the user explicitly added — not every
// configured provider. This keeps the daily-driver surface small. Adding a
// provider to the home list does NOT switch to it; it just surfaces it for
// quick switching. Removing hides it from the home list without deleting it.

async function addHomeProvider(req, res) {
  try {
    const { agentId } = req.params;
    const { providerId } = req.body;
    if (!agentId || !providerId) {
      return res.status(400).json({ error: 'Missing agentId or providerId' });
    }
    const config = await loadUserConfig();
    const home = { ...(config.homeProviders || {}) };
    const list = Array.isArray(home[agentId]) ? [...home[agentId]] : [];
    if (!list.includes(providerId)) list.push(providerId);
    home[agentId] = list;
    config.homeProviders = home;
    await saveUserConfig(config);
    res.json({ success: true, homeProviders: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function removeHomeProvider(req, res) {
  try {
    const { agentId, providerId } = req.params;
    if (!agentId || !providerId) {
      return res.status(400).json({ error: 'Missing agentId or providerId' });
    }
    const config = await loadUserConfig();
    const home = { ...(config.homeProviders || {}) };
    const list = Array.isArray(home[agentId]) ? home[agentId].filter(id => id !== providerId) : [];
    if (list.length === 0) {
      delete home[agentId];
    } else {
      home[agentId] = list;
    }
    config.homeProviders = home;
    await saveUserConfig(config);

    // If the user removed the LAST provider OR the currently-active provider
    // for a single-type agent (claude / codex / gemini), auto-switch back to
    // the official subscription so the CLI doesn't keep using stale config.
    // Single-type agents are exclusive — the active provider must always be
    // one that still exists in the home list.
    const SINGLE_TYPE_AGENTS = {
      'claude': { providerId: 'anthropic-agent', modelId: 'claude-sonnet-4-6' },
      'codex': { providerId: 'openai-codex', modelId: 'gpt-5.6-sol' },
      'gemini': { providerId: 'google-agent', modelId: 'gemini-2.5-pro' },
    };
    const currentSel = config.providers?.[agentId];
    const removedWasCurrent = currentSel?.providerId === providerId;
    const shouldFallback = list.length === 0 || removedWasCurrent;
    if (shouldFallback && SINGLE_TYPE_AGENTS[agentId]) {
      try {
        const fallback = SINGLE_TYPE_AGENTS[agentId];
        const adapter = ADAPTERS.find(a => a.id === agentId);
        const providers = await loadProviders();
        const provider = providers.find(p => p.id === fallback.providerId);
        if (adapter && provider && adapterSupportsProvider(adapter, provider)) {
          const agentAdapter = _getAdapter(agentId);
          if (agentAdapter) {
            await agentAdapter.applyConfig(provider, fallback.modelId);
            const cfg = await loadUserConfig();
            if (!cfg.providers) cfg.providers = {};
            cfg.providers[agentId] = { providerId: fallback.providerId, modelId: fallback.modelId };
            await saveUserConfig(cfg);
          }
        }
      } catch (e) {
        // Don't fail the remove if the fallback switch errors — the provider
        // was already removed from the home list.
        console.warn(`[removeHomeProvider] fallback switch failed: ${e.message}`);
      }
    }

    res.json({ success: true, homeProviders: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Agent config file viewer (read-only) -----------------------------------
//
// Each agent writes to a well-known config file (or two). This endpoint reads
// those files so the user can verify a switch actually landed on disk, without
// leaving the UI. Read-only — never writes.

const AGENT_CONFIG_FILES = {
  'claude': ['.claude/settings.json'],
  'codex': ['.codex/config.toml', '.codex/.env', '.codex/model-catalogs/model-catalogs.json'],
  'gemini': ['.gemini/.env', '.gemini/settings.json'],
  'opencode': ['.config/opencode/opencode.json'],
  'openclaw': ['.openclaw/openclaw.json'],
  'workbuddy': ['.workbuddy/models.json'],
  'zcode': ['.zcode/config.json'],
  'hermes': ['.hermes/config.json'],
  'kimi-code': ['.kimi-code/config.toml', '.kimi-code/.env'],
};

async function getAgentConfigFiles(req, res) {
  try {
    const { agentId } = req.params;
    const relPaths = AGENT_CONFIG_FILES[agentId];
    if (!relPaths) {
      return res.status(404).json({ error: `No config files mapped for agent: ${agentId}` });
    }
    const home = os.homedir();
    const files = await Promise.all(relPaths.map(async (rel) => {
      const fullPath = path.join(home, rel);
      const exists = await fs.pathExists(fullPath);
      let content = null;
      if (exists) {
        try {
          content = await fs.readFile(fullPath, 'utf-8');
          // Cap at 64KB so a pathological file can't blow up the UI.
          if (content.length > 65536) content = content.slice(0, 65536) + '\n…(truncated)';
        } catch {
          content = '(读取失败)';
        }
      }
      return { path: `~/${rel}`, exists, content };
    }));
    res.json({ agentId, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Save edited config file content. Only paths registered in AGENT_CONFIG_FILES
// for the given agent are writable — this prevents arbitrary file writes. The
// client sends the `~`-prefixed path it got from GET; we strip the prefix and
// match against the whitelist before touching disk.
async function saveAgentConfigFile(req, res) {
  try {
    const { agentId } = req.params;
    const { filePath, content } = req.body;
    const relPaths = AGENT_CONFIG_FILES[agentId];
    if (!relPaths) {
      return res.status(404).json({ error: `No config files mapped for agent: ${agentId}` });
    }
    if (!filePath || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing filePath or content' });
    }
    // Normalize: strip leading ~/ then match exactly against the whitelist.
    const rel = filePath.startsWith('~/') ? filePath.slice(2) : filePath;
    if (!relPaths.includes(rel)) {
      return res.status(403).json({ error: `Path not in writable whitelist: ${filePath}` });
    }
    const fullPath = path.join(os.homedir(), rel);
    // Refuse to follow symlinks or escape the home dir.
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf-8');
    res.json({ success: true, path: `~/${rel}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Codex model-catalog exclusion -----------------------------------------
//
// Users choose which of a provider's models appear in Codex's /model list by
// unchecking them in the UI. We persist the UNCHECKED ids (not the checked
// ones) so that a brand-new model on the provider defaults to "checked =
// visible" without the user having to opt in. Toggling rewrites the catalog
// immediately so the change is reflected next time Codex reads it.

async function setCatalogExcluded(req, res) {
  try {
    const { providerId } = req.params;
    const { excluded } = req.body; // string[] of model ids to EXCLUDE
    if (!providerId || !Array.isArray(excluded)) {
      return res.status(400).json({ error: 'Missing providerId or excluded[]' });
    }
    const config = await loadUserConfig();
    if (!config.codexCatalogExcluded) config.codexCatalogExcluded = {};
    config.codexCatalogExcluded[providerId] = excluded;
    await saveUserConfig(config);
    res.json({ success: true, providerId, excluded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getCatalogExcluded(_req, res) {
  try {
    const config = await loadUserConfig();
    res.json({ excluded: config.codexCatalogExcluded || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Claude Code tier mapping ------------------------------------------------
//
// Claude Code uses ANTHROPIC_MODEL + DEFAULT_HAIKU/SONNET/OPUS_MODEL. For
// third-party providers the user can map each tier to a different model id so
// Claude Code's internal tier-switching (fast/standard/powerful) routes to the
// right model on the gateway. We persist per-provider overrides; switching to
// a provider without overrides defaults all tiers to the selected model.

async function getTierMaps(_req, res) {
  try {
    const config = await loadUserConfig();
    res.json({ tierMaps: config.claudeTierMaps || {} });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function setTierMap(req, res) {
  try {
    const { providerId } = req.params;
    const { haiku, sonnet, opus } = req.body;
    if (!providerId) {
      return res.status(400).json({ error: 'Missing providerId' });
    }
    const config = await loadUserConfig();
    if (!config.claudeTierMaps) config.claudeTierMaps = {};
    // Empty string / null = clear that tier (fall back to ANTHROPIC_MODEL).
    const map = {};
    if (haiku) map.haiku = haiku;
    if (sonnet) map.sonnet = sonnet;
    if (opus) map.opus = opus;
    if (Object.keys(map).length === 0) {
      delete config.claudeTierMaps[providerId];
    } else {
      config.claudeTierMaps[providerId] = map;
    }
    await saveUserConfig(config);
    res.json({ success: true, providerId, tierMap: map });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    anthropic: { name: 'Claude Code', cli: 'claude', cliArgs: ['auth', 'login', '--claudeai'] },
    'anthropic-agent': { name: 'Claude Code', cli: 'claude', cliArgs: ['auth', 'login', '--claudeai'] },
    'openai-codex': { name: 'ChatGPT', url: 'https://chatgpt.com/', cli: 'codex', cliArgs: ['auth', 'login'] },
    'google-agent': { name: 'Gemini CLI', cli: 'gemini', cliArgs: [] },
    'xai-grok-build': { name: 'Grok Build', cli: 'grok', cliArgs: ['login'] },
    'github-copilot': { name: 'GitHub Copilot', cli: 'copilot', cliArgs: ['login'] },
  };

  const entry = entries[providerId];
  if (!entry) {
    return res.status(400).json({ error: `${providerId} 不支持 OAuth 登录` });
  }

  // Try CLI login first (if installed), fall back to opening URL.
  // safe: cliArgs comes from the hardcoded `entries` registry above, not user input.
  // Still validate each arg is a string to defend against any unexpected mutation.
  const cliPath = findCommand(entry.cli);
  if (cliPath) {
    if (!Array.isArray(entry.cliArgs) || entry.cliArgs.some(a => typeof a !== 'string')) {
      return res.status(500).json({ error: 'invalid cliArgs' });
    }
    const launched = launchInteractiveCli(platform, cliPath, entry.cliArgs);
    if (!launched) {
      return res.status(500).json({
        error: `无法打开交互式终端，请手动运行：${entry.cli} ${entry.cliArgs.join(' ')}`,
      });
    }
    return res.json({
      success: true,
      message: `已在终端打开 ${entry.name} OAuth 登录`,
    });
  }

  // A normal web login cannot create local CLI credentials. Providers without
  // a browser-only fallback must tell the user which CLI login to run instead
  // of opening an unrelated account console.
  if (!entry.url) {
    return res.status(400).json({
      error: `未检测到 ${entry.name} CLI，请先安装 ${entry.cli}，再运行：${entry.cli} ${entry.cliArgs.join(' ')}`,
    });
  }

  // Browser-only fallback for providers whose login can complete without a
  // local CLI callback.
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

function launchInteractiveCli(platform, cliPath, args) {
  const { spawn } = require('child_process');
  const env = { ...process.env, FORCE_COLOR: '1' };

  if (platform === 'darwin') {
    const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
    const command = [cliPath, ...args].map(quote).join(' ');
    const child = spawn('/usr/bin/osascript', [
      '-e', 'tell application "Terminal" to activate',
      '-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`,
    ], { detached: true, stdio: 'ignore', env });
    child.unref();
    return true;
  }

  if (platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', cliPath, ...args], {
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.unref();
    return true;
  }

  const terminalCandidates = [
    { command: 'x-terminal-emulator', args: ['-e'] },
    { command: 'gnome-terminal', args: ['--'] },
    { command: 'konsole', args: ['-e'] },
  ];
  for (const terminal of terminalCandidates) {
    const terminalPath = findCommand(terminal.command);
    if (!terminalPath) continue;
    const child = spawn(terminalPath, [...terminal.args, cliPath, ...args], {
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.unref();
    return true;
  }
  return false;
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
      case 'anthropic':
      case 'anthropic-agent': {
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
      case 'google-agent': {
        const geminiDir = path.join(home, '.gemini');
        return ['oauth_creds.json', 'google_accounts.json']
          .some(file => fs.existsSync(path.join(geminiDir, file)));
      }
      case 'xai-grok-build': {
        const authPath = path.join(home, '.grok', 'auth.json');
        if (!fs.existsSync(authPath)) return false;
        const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        const credentials = [data, ...Object.values(data || {})]
          .filter(value => value && typeof value === 'object' && !Array.isArray(value));
        return credentials.some(credential => !!(
          credential.key
          || credential.refresh_token
          || credential.access_token
          || credential.accessToken
          || credential.tokens?.access_token
        ));
      }
      case 'github-copilot': {
        if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
        if (os.platform() === 'darwin') {
          const { spawnSync } = require('child_process');
          const result = spawnSync('security', ['find-generic-password', '-s', 'copilot-cli'], {
            stdio: 'ignore',
            timeout: 5000,
          });
          if (result.status === 0) return true;
        }
        for (const filename of ['auth.json', 'config.json']) {
          const credentialPath = path.join(home, '.copilot', filename);
          if (!fs.existsSync(credentialPath)) continue;
          const data = JSON.parse(fs.readFileSync(credentialPath, 'utf-8'));
          if (data.access_token || data.accessToken || data.oauth_token || data.token) return true;
        }
        return false;
      }
      default:
        return null;
    }
  } catch {
    return false;
  }
}

async function readCodexCachedModels() {
  const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
  if (!(await fs.pathExists(cachePath))) {
    throw new Error('未找到 Codex 模型缓存，请先完成 OAuth 登录并启动一次 Codex');
  }

  let cache;
  try {
    cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    throw new Error('Codex 模型缓存无法读取');
  }

  const entries = Array.isArray(cache) ? cache : cache.models;
  if (!Array.isArray(entries)) throw new Error('Codex 模型缓存格式无效');

  const models = [];
  const seen = new Set();
  for (const entry of entries) {
    const id = typeof entry === 'string' ? entry : (entry?.slug || entry?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: typeof entry === 'string' ? entry : (entry.display_name || entry.name || id),
    });
  }
  if (models.length === 0) throw new Error('Codex 模型缓存中没有可用模型');
  return models;
}

async function readGrokCliModels() {
  const cliPath = findCommand('grok');
  if (!cliPath) throw new Error('未检测到 Grok Build CLI，请先安装 Grok Build');
  const { spawnSync } = require('child_process');
  const result = spawnSync(cliPath, ['models'], {
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error((result.stderr || '').trim() || 'Grok 模型列表读取失败');
  const marker = 'Available models:';
  const output = String(result.stdout || '');
  const lines = output.includes(marker) ? output.slice(output.indexOf(marker) + marker.length).split(/\r?\n/) : [];
  const models = lines.map(line => {
    const match = line.match(/^\s*[*-]\s+([^\s(]+)/);
    return match ? { id: match[1], name: match[1] } : null;
  }).filter(Boolean);
  if (!models.length) throw new Error('Grok CLI 没有返回可用模型，请先完成 grok login');
  return models;
}

async function readCopilotCliModels() {
  const cliPath = findCommand('copilot');
  if (!cliPath) throw new Error('未检测到 GitHub Copilot CLI，请先安装 Copilot CLI');

  const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk');
  const client = new CopilotClient({
    connection: RuntimeConnection.forStdio({ path: cliPath }),
    useLoggedInUser: true,
    workingDirectory: process.cwd(),
    logLevel: 'error',
  });

  try {
    await client.start();
    const entries = await client.listModels();
    const seen = new Set();
    const models = entries
      .filter(entry => entry?.id && !seen.has(entry.id) && seen.add(entry.id))
      .map(entry => ({ id: entry.id, name: entry.name || entry.label || entry.id }));
    if (models.length === 0) throw new Error('Copilot 当前账号没有返回可用模型');
    return models;
  } finally {
    await client.stop().catch(() => client.forceStop());
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

    if (p?.id === 'openai-codex' && !previewConfig) {
      const models = await readCodexCachedModels();
      p.models = models;
      await backupImportantData('providers');
      await fs.writeFile(PROVIDERS_PATH, JSON.stringify({ providers, version: 1 }, null, 2));
      return res.json({ success: true, models });
    }

    if (p?.id === 'xai-grok-build' && !previewConfig) {
      if (!(await detectOAuth(p.id))) throw new Error('请先完成 Grok Build 登录');
      const models = await readGrokCliModels();
      p.models = models;
      await backupImportantData('providers');
      await fs.writeFile(PROVIDERS_PATH, JSON.stringify({ providers, version: 1 }, null, 2));
      return res.json({ success: true, models });
    }

    if (p?.id === 'github-copilot' && !previewConfig) {
      if (!(await detectOAuth(p.id))) throw new Error('请先完成 GitHub Copilot 登录');
      const models = await readCopilotCliModels();
      p.models = models;
      await backupImportantData('providers');
      await fs.writeFile(PROVIDERS_PATH, JSON.stringify({ providers, version: 1 }, null, 2));
      return res.json({ success: true, models });
    }

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
  addFavoriteModel,
  removeFavoriteModel,
  getFavoriteModels,
  addHomeProvider,
  removeHomeProvider,
  getAgentConfigFiles,
  saveAgentConfigFile,
  setCatalogExcluded,
  getCatalogExcluded,
  getTierMaps,
  setTierMap,
  launchAgent,
  getAuthStatus,
  triggerOAuthLogin,
  fetchModels,
};
