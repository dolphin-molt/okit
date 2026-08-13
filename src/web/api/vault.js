const { VaultStore } = require('../../vault/store');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const {
  isQianfanCodingEndpoint,
  qianfanCodingErrorCode,
  qianfanCodingErrorMessage,
} = require('./qianfan-coding');
const { pickProbeModel } = require('./endpoint-profiles');

const store = new VaultStore();

const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

/** Safely find files by name using Node.js fs (no shell, no command injection). */
function safeFindFiles(baseDir, targetNames, maxDepth) {
  const results = [];
  const nameSet = new Set(Array.isArray(targetNames) ? targetNames : [targetNames]);
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && nameSet.has(entry.name)) {
        results.push(fullPath);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(fullPath, depth + 1);
      }
    }
  }
  walk(baseDir, 0);
  return results;
}

function appendVaultLog(action, key, success, detail) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      name: key,
      action,
      success,
      duration: 0,
    };
    if (detail) entry.output = detail;
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

// Find .okitenv files that reference a given key
async function findLinkedProjects(key) {
  const home = os.homedir();
  const projects = [];

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const files = safeFindFiles(base, ['.okitenv', '.okit-env'], 3);
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          const referenced = lines.some(line => {
            const colonIdx = line.indexOf(':');
            const source = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : line;
            const envName = colonIdx > 0 ? line.slice(0, colonIdx).trim() : line;
            return envName === key || source === key || source.startsWith(key + '/');
          });
          if (referenced) {
            projects.push(path.dirname(file));
          }
        } catch {}
      }
    }
  } catch {}
  return projects;
}

// Find all .okitenv files under ~/Desktop and touch them so hooks re-inject
async function touchOkitEnvFiles(key) {
  const home = os.homedir();

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const files = safeFindFiles(base, ['.okitenv', '.okit-env'], 3);
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

          // Check if this key is referenced in this .okitenv
          const referenced = lines.some(line => {
            const colonIdx = line.indexOf(':');
            const envName = colonIdx > 0 ? line.slice(0, colonIdx).trim() : line;
            const source = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : line;
            // Check both envName and source match the key
            return envName === key || source === key || source.startsWith(key + '/');
          });

          if (referenced) {
            // Touch the file to update mtime so hook re-runs
            const now = new Date();
            await fs.utimes(file, now, now);
          }
        } catch {}
      }
    }
  } catch {}
}

// Remove a key reference from all .okitenv files
async function removeKeyFromOkitEnvFiles(key) {
  const home = os.homedir();

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const files = safeFindFiles(base, ['.okitenv', '.okit-env'], 3);
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          const filtered = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return true;
            const colonIdx = trimmed.indexOf(':');
            const envName = colonIdx > 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
            const source = colonIdx > 0 ? trimmed.slice(colonIdx + 1).trim() : trimmed;
            const matchKey = (s) => s === key || s === `${key}/default` || s.startsWith(`${key}/`);
            return !matchKey(envName) && !matchKey(source);
          });
          const newContent = filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
          if (newContent !== content) {
            await fs.writeFile(file, newContent);
          }
        } catch {}
      }
    }
  } catch {}
}

async function listVault(req, res) {
  try {
    const [entries, bindings] = await Promise.all([
      store.list(),
      store.getBindings(),
    ]);

    // Attach bindings to each key
    const secrets = entries.map(entry => ({
      ...entry,
      bindings: bindings.filter(binding => binding.key === entry.key),
    }));

    res.json({ secrets, totalBindings: bindings.length });
  } catch (error) {
    console.error('Error listing vault:', error);
    res.status(500).json({ error: 'Failed to list vault' });
  }
}

async function setVault(req, res) {
  try {
    const { key, value, desc, group, expiresAt, originalKey } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    const isEditMove = originalKey && originalKey !== key;

    if (isEditMove) {
      const oldValue = await store.get(originalKey);
      if (oldValue === null) {
        return res.status(404).json({ error: 'Original secret not found' });
      }

      const existingTarget = await store.get(key);
      if (existingTarget !== null) {
        return res.status(409).json({ error: 'Target secret already exists' });
      }
    }

    await store.set(key, value, group, expiresAt, desc);
    if (isEditMove) {
      await store.delete(originalKey);
      touchOkitEnvFiles(originalKey);
    }
    touchOkitEnvFiles(key);
    appendVaultLog('vault-set', key, true);
    res.json({ success: true, key, desc: desc || '' });

    // Auto-sync to enabled platforms (fire-and-forget)
    autoSyncToPlatforms(key);
  } catch (error) {
    console.error('Error setting vault:', error);
    appendVaultLog('vault-set', req.body.key || '', false, error.message);
    res.status(500).json({ error: 'Failed to set secret' });
  }
}

async function deleteVault(req, res) {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const deleted = await store.delete(key);
    if (deleted) {
      removeKeyFromOkitEnvFiles(key);
      appendVaultLog('vault-delete', key, true);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Secret not found' });
    }
  } catch (error) {
    console.error('Error deleting vault:', error);
    appendVaultLog('vault-delete', req.body.key || '', false, error.message);
    res.status(500).json({ error: 'Failed to delete secret' });
  }
}

async function checkKeyImpact(req, res) {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const projects = await findLinkedProjects(key);
    res.json({ key, projects });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check impact' });
  }
}

async function exportVault(req, res) {
  try {
    const secrets = await store.exportAll();
    const bindings = await store.getBindings();
    const data = { secrets, bindings, exportedAt: new Date().toISOString() };
    res.setHeader('Content-Disposition', 'attachment; filename="okit-vault-export.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (error) {
    console.error('Error exporting vault:', error);
    res.status(500).json({ error: 'Failed to export vault' });
  }
}

async function importVault(req, res) {
  try {
    const { secrets } = req.body;
    if (!Array.isArray(secrets) || secrets.length === 0) {
      return res.status(400).json({ error: 'No secrets provided' });
    }
    let imported = 0;
    let skipped = 0;
    for (const s of secrets) {
      if (!s.key) { skipped++; continue; }
      const existing = await store.get(s.key);
      if (existing) { skipped++; continue; }
      if (s.value) {
        await store.set(s.key, s.value, s.group, s.expiresAt, s.desc);
        imported++;
      } else {
        skipped++;
      }
    }
    res.json({ success: true, imported, skipped, total: secrets.length });
  } catch (error) {
    console.error('Error importing vault:', error);
    res.status(500).json({ error: 'Failed to import vault' });
  }
}

async function getVaultValue(req, res) {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const value = await store.get(key);
    if (value === null) return res.status(404).json({ error: 'Secret not found' });
    res.json({ value });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get secret' });
  }
}

async function syncVaultToProject(req, res) {
  const fs = require('fs-extra');
  const path = require('path');
  try {
    const { keys, projectPath } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys is required' });
    }
    if (!projectPath || typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'projectPath is required' });
    }

    const okitEnvFile = path.join(projectPath, '.okitenv');
    let content = '';
    if (await fs.pathExists(okitEnvFile)) {
      content = await fs.readFile(okitEnvFile, 'utf-8');
    }

    const existingKeys = new Set(
      content.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => {
          const colonIdx = l.indexOf(':');
          return colonIdx > 0 ? l.slice(0, colonIdx).trim() : l;
        })
    );

    const results = [];
    for (const item of keys) {
      const value = await store.get(item.key);
      if (value === null) {
        results.push({ key: item.key, success: false, error: '密钥不存在' });
        continue;
      }
      const envKey = item.key;
      if (!existingKeys.has(envKey)) {
        content = content.trimEnd() + (content.length > 0 ? '\n' : '') + `${envKey}\n`;
      }
      results.push({ key: item.key, success: true });
    }

    await fs.ensureDir(projectPath);
    await fs.writeFile(okitEnvFile, content);

    const synced = results.filter(r => r.success).length;
    const failed = results.length - synced;
    res.json({ success: true, synced, failed, results, file: '.okitenv' });
  } catch (error) {
    console.error('Error syncing to project:', error);
    res.status(500).json({ error: error.message || 'Failed to sync' });
  }
}

async function browseDirs(req, res) {
  const fs = require('fs');
  const path = require('path');
  try {
    let dir = req.query.path || process.env.HOME;
    dir = path.resolve(dir);

    if (!fs.existsSync(dir)) {
      return res.status(400).json({ error: '目录不存在' });
    }

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const hasEnv = fs.existsSync(path.join(dir, '.env'));
    const parentPath = dir === '/' ? '' : path.dirname(dir);

    res.json({ currentPath: dir, parentPath, dirs, hasEnv });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to browse' });
  }
}

// Scan all .okitenv files and return project → keys mapping
async function listProjects(req, res) {
  const home = os.homedir();
  const projects = [];

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const files = safeFindFiles(base, ['.okitenv', '.okit-env'], 3);
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const keys = [];
          for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
              const envName = line.slice(0, colonIdx).trim();
              const source = line.slice(colonIdx + 1).trim();
              keys.push({ envName, source });
            } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(line)) {
              keys.push({ envName: line, source: line });
            }
          }
          if (keys.length > 0) {
            const projectPath = path.dirname(file);
            const projectName = path.basename(projectPath);
            const hasEnv = fs.existsSync(path.join(projectPath, '.env'));
            projects.push({ path: projectPath, name: projectName, keys, hasEnv });
          }
        } catch {}
      }
    }
  } catch {}

  res.json({ projects });
}

// Get project bindings for each key in vault list
async function listVaultWithProjects(req, res) {
  try {
    const [entries, bindings] = await Promise.all([
      store.list(),
      store.getBindings(),
    ]);

    // Scan .okitenv files to find actual project references
    const home = os.homedir();
    const keyProjects = {}; // key → [{path, name}]

    try {
      const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
      for (const dir of dirs) {
        const base = path.join(home, dir);
        if (!fs.existsSync(base)) continue;
        const files = safeFindFiles(base, ['.okitenv', '.okit-env'], 3);
        for (const file of files) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            const projectPath = path.dirname(file);
            const projectName = path.basename(projectPath);
            for (const rawLine of content.split('\n')) {
              const line = rawLine.trim();
              if (!line || line.startsWith('#')) continue;
              const colonIdx = line.indexOf(':');
              const envName = colonIdx > 0 ? line.slice(0, colonIdx).trim() : line;
              const source = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : line;
              const vaultKey = source;
              // Match by envName or vaultKey
              for (const k of [envName, vaultKey]) {
                if (!keyProjects[k]) keyProjects[k] = [];
                if (!keyProjects[k].find(p => p.path === projectPath)) {
                  keyProjects[k].push({ path: projectPath, name: projectName });
                }
              }
            }
          } catch {}
        }
      }
    } catch {}

    const secrets = entries.map(entry => ({
      ...entry,
      projects: keyProjects[entry.key] || [],
    }));

    res.json({ secrets, totalBindings: bindings.length });
  } catch (error) {
    console.error('Error listing vault:', error);
    res.status(500).json({ error: 'Failed to list vault' });
  }
}

async function autoSyncToPlatforms(key) {
  try {
    const configPath = path.join(os.homedir(), '.okit', 'user.json');
    if (!fs.existsSync(configPath)) return;
    const config = await fs.readJson(configPath);
    const sync = config.sync;
    if (!sync?.autoSync || !sync.platforms) return;
    const { pushSecrets } = require('./cloud-sync-core');

    for (const [platformId, platConfig] of Object.entries(sync.platforms)) {
      if (!platConfig.enabled) continue;
      try {
        // Reuse the same path as manual cloud sync so vault-backed platform
        // credentials are resolved before an adapter receives its config.
        const results = await pushSecrets(platformId, [key]);
        const failed = results.filter(r => !r.success);
        if (failed.length === 0) {
          appendVaultLog('auto-sync', `${key} → ${platformId}`, true);
        } else {
          appendVaultLog('auto-sync', `${key} → ${platformId}`, false, failed.map(r => r.error).join('; '));
        }
      } catch (error) {
        appendVaultLog('auto-sync', `${key} → ${platformId}`, false, error.message);
      }
    }
  } catch {}
}

async function testApiKey(req, res) {
  const { baseUrl, type, protocol, keyValue, vaultKey } = req.body;
  if (!baseUrl) {
    return res.status(400).json({ success: false, message: '缺少 baseUrl' });
  }

  let resolvedKey = keyValue;
  if (!resolvedKey && vaultKey) {
    try {
      await store.reload();
      resolvedKey = await store.get(vaultKey);
    } catch (err) {
      console.error('resolveVaultKey error:', err);
    }
  }
  if (!resolvedKey) {
    // ChatGPT/Codex OAuth endpoints don't use an API key — the access token
    // lives in ~/.codex/auth.json. Probe that path before giving up so the
    // UI can show a meaningful status for the openai-codex provider.
    if (isCodexOAuthEndpoint(baseUrl)) {
      return probeCodexOAuth(res);
    }
    return res.json({ success: false, message: '无可用密钥，请先绑定 API Key' });
  }

  try {
    let url;
    const headers = {};

    if (type === 'anthropic') {
      url = `${baseUrl}/v1/messages`;
      const isZaiAnthropic = isZaiAnthropicEndpoint(baseUrl);
      const isMiniMaxAnthropic = isMiniMaxAnthropicEndpoint(baseUrl);
      if (isZaiAnthropic) {
        // Z.AI's Anthropic-compatible coding endpoint expects a GLM model
        // and the platform's standard Bearer authentication. The generic
        // Claude probe (claude-haiku + x-api-key) is not a valid Z.AI probe.
        headers['Authorization'] = `Bearer ${resolvedKey}`;
        headers['accept-language'] = 'en-US,en';
      } else if (isMiniMaxAnthropic) {
        // MiniMax documents X-Api-Key for its Anthropic-compatible API.
        // Prefer the read-only model list below so an unavailable inference
        // entitlement is not mistaken for an invalid endpoint or credential.
        headers['X-Api-Key'] = resolvedKey;
      } else {
        headers['x-api-key'] = resolvedKey;
      }
      headers['anthropic-version'] = '2023-06-01';
      headers['content-type'] = 'application/json';

      // Z.AI exposes a read-only model-list endpoint for its Anthropic
      // compatibility layer. Use it as the connection probe first so a
      // valid key is not reported as disconnected merely because the account
      // has no inference balance (business error 1113).
      if (isZaiAnthropic) {
        const modelsResult = await httpRequest(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
          method: 'GET',
          headers,
          timeout: 10000,
        });
        if (modelsResult.error) return res.json({ success: false, message: `连接失败: ${modelsResult.error}` });
        if (modelsResult.status === 401) return res.json({ success: false, message: 'API Key 无效' });
        if (modelsResult.status === 200) {
          let modelCount = 0;
          try { modelCount = JSON.parse(modelsResult.body).data?.length || 0; } catch {}
          return res.json({
            success: true,
            message: `端点连接成功，Key 有效，可读取 ${modelCount} 个模型；实际对话调用仍需 Z.AI 账户资源包`,
          });
        }
        if (modelsResult.status === 429 && zaiErrorCode(modelsResult.body) === '1113') {
          return res.json({ success: false, message: '端点可达，但 Z.AI 账户余额或资源包不足（1113），请充值或开通对应资源包后重试' });
        }
        // If a deployment does not expose /v1/models, continue with the
        // protocol-compatible one-token message probe below.
      }

      if (isMiniMaxAnthropic) {
        const modelsResult = await httpRequest(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
          method: 'GET',
          headers,
          timeout: 10000,
        });
        if (modelsResult.error) return res.json({ success: false, message: `连接失败: ${modelsResult.error}` });
        if (modelsResult.status === 401) return res.json({ success: false, message: 'API Key 无效' });
        if (modelsResult.status === 200) {
          let modelCount = 0;
          try { modelCount = JSON.parse(modelsResult.body).data?.length || 0; } catch {}
          return res.json({
            success: true,
            message: `MiniMax Anthropic 端点连接成功，Key 有效，可读取 ${modelCount} 个模型`,
          });
        }
        // Older deployments may not expose the model list. Fall back to the
        // protocol-compatible one-token message probe below.
      }

      const body = JSON.stringify({
        model: isZaiAnthropic ? 'glm-4.7' : pickProbeModel(baseUrl),
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      const result = await httpRequest(url, { method: 'POST', headers, body, timeout: 10000 });
      if (result.error) return res.json({ success: false, message: `连接失败: ${result.error}` });
      if (result.status === 401) return res.json({ success: false, message: 'API Key 无效' });
      if (result.status === 200 || result.status === 400) return res.json({ success: true, message: '连接成功，Key 有效' });
      if (isZaiAnthropic && (result.status === 429 || zaiErrorCode(result.body) === '1113')) {
        return res.json({ success: false, message: '端点可达，但 Z.AI 账户余额或资源包不足（1113），请充值或开通对应资源包后重试' });
      }
      return res.json({ success: false, message: `HTTP ${result.status}: ${truncateBody(result.body)}` });
    } else if (type === 'google') {
      url = `${baseUrl}/v1beta/models?key=${resolvedKey}`;
      const result = await httpRequest(url, { method: 'GET', timeout: 10000 });
      if (result.error) return res.json({ success: false, message: `连接失败: ${result.error}` });
      if (result.status === 400 || result.status === 403) return res.json({ success: false, message: 'API Key 无效' });
      if (result.status === 200) return res.json({ success: true, message: '连接成功，Key 有效' });
      return res.json({ success: false, message: `HTTP ${result.status}: ${truncateBody(result.body)}` });
    } else {
      // Qianfan Coding Plan has its own credential scope and does not accept
      // the regular V2 API key. Probe its documented chat endpoint directly so
      // the UI can distinguish a key-scope error from a generic 401 failure.
      headers['Authorization'] = `Bearer ${resolvedKey}`;
      headers['content-type'] = 'application/json';
      if (isQianfanCodingEndpoint(baseUrl)) {
        const codingResult = await probeQianfanCodingApi(baseUrl, headers);
        if (codingResult.error) return res.json({ success: false, message: `连接失败: ${codingResult.error}` });
        const codingCode = qianfanCodingErrorCode(codingResult.body);
        const codingMessage = qianfanCodingErrorMessage(codingCode);
        if (codingMessage) return res.json({ success: false, message: codingMessage });
        if (codingResult.status === 401) return res.json({ success: false, message: '百度千帆 Coding Plan API Key 无效' });
        if (codingResult.status === 200) return res.json({ success: true, message: '百度千帆 Coding Plan 连接成功，Key 有效' });
        if (codingResult.status === 400) return res.json({ success: true, message: '百度千帆 Coding Plan 端点可达，Key 已通过鉴权' });
        return res.json({ success: false, message: `HTTP ${codingResult.status}: ${truncateBody(codingResult.body)}` });
      }

      // openai compatible — try /models first, fallback to the selected wire API probe
      url = baseUrl.replace(/\/+$/, '') + '/models';
      let result = await httpRequest(url, { method: 'GET', headers, timeout: 10000 });

      if (result.error) {
        // Connection failed entirely, try the selected generation endpoint as fallback.
        result = await probeOpenAIWireApi(baseUrl, headers, protocol);
        if (result.error) return res.json({ success: false, message: `连接失败: ${result.error}` });
        if (result.status === 401) return res.json({ success: false, message: 'API Key 无效' });
        if (result.status === 200 || result.status === 400) return res.json({ success: true, message: '连接成功，Key 有效' });
        return res.json({ success: false, message: `HTTP ${result.status}: ${truncateBody(result.body)}` });
      }

      if (result.status === 401) return res.json({ success: false, message: 'API Key 无效' });
      if (result.status === 200) {
        let modelCount = 0;
        try { const d = JSON.parse(result.body); modelCount = d.data?.length || 0; } catch {}
        return res.json({ success: true, message: `连接成功，可用 ${modelCount} 个模型` });
      }
      if (result.status === 404 || result.status === 403 || result.status === 405) {
        // /models not available, try the selected generation endpoint.
        const probeResult = await probeOpenAIWireApi(baseUrl, headers, protocol);
        if (probeResult.error) return res.json({ success: false, message: `连接失败: ${probeResult.error}` });
        if (probeResult.status === 401) return res.json({ success: false, message: 'API Key 无效' });
        if (probeResult.status === 200 || probeResult.status === 400) return res.json({ success: true, message: '连接成功，Key 有效' });
        return res.json({ success: false, message: `HTTP ${probeResult.status}: ${truncateBody(probeResult.body)}` });
      }
      return res.json({ success: false, message: `HTTP ${result.status}: ${truncateBody(result.body)}` });
    }
  } catch (err) {
    res.json({ success: false, message: `连接失败: ${err.message}` });
  }
}

function isZaiAnthropicEndpoint(baseUrl) {
  return /^https?:\/\/api\.z\.ai\/api\/anthropic\/?$/i.test(String(baseUrl || '').trim());
}

function isMiniMaxAnthropicEndpoint(baseUrl) {
  return /^https?:\/\/api\.minimax(?:i\.com|\.io)\/anthropic\/?$/i.test(String(baseUrl || '').trim());
}

function isCodexOAuthEndpoint(baseUrl) {
  return /^https?:\/\/chatgpt\.com\/backend-api\/codex\/?/i.test(String(baseUrl || '').trim());
}

// Probe the ChatGPT/Codex OAuth token stored at ~/.codex/auth.json. The token
// is validated against the Codex backend models endpoint. Returns a meaningful
// message for each outcome (logged in, token expired, not logged in).
async function probeCodexOAuth(res) {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    await fs.ensureDir(path.dirname(authPath));
    if (!await fs.pathExists(authPath)) {
      return res.json({ success: false, message: '尚未登录 ChatGPT，请先点击 OAuth 登录' });
    }
    const content = await fs.readFile(authPath, 'utf-8');
    const data = JSON.parse(content);
    if (data.auth_mode !== 'chatgpt' || !data.tokens?.access_token) {
      return res.json({ success: false, message: '尚未登录 ChatGPT，请先点击 OAuth 登录' });
    }
    const accessToken = data.tokens.access_token;
    const result = await httpRequest('https://chatgpt.com/backend-api/codex/models', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'ChatGPT-Account-Id': data.account_id || '' },
      timeout: 10000,
    });
    if (result.error) return res.json({ success: false, message: `连接失败: ${result.error}` });
    if (result.status === 401 || result.status === 403) {
      return res.json({ success: false, message: 'OAuth Token 已过期，请重新登录 ChatGPT' });
    }
    if (result.status === 200) {
      let modelCount = 0;
      try { modelCount = JSON.parse(result.body).data?.length || 0; } catch {}
      return res.json({ success: true, message: `ChatGPT OAuth 连接成功，可用 ${modelCount} 个模型` });
    }
    // Some Codex backends respond 404 to /models; treat reachability + valid
    // token as success if the endpoint at least does not reject auth.
    if (result.status === 404 || result.status === 405) {
      return res.json({ success: true, message: 'ChatGPT OAuth 连接成功，Token 有效' });
    }
    return res.json({ success: false, message: `HTTP ${result.status}` });
  } catch (err) {
    return res.json({ success: false, message: `连接失败: ${err.message}` });
  }
}

function zaiErrorCode(body) {
  try {
    const parsed = JSON.parse(body || '{}');
    const code = parsed?.error?.code ?? parsed?.code;
    return code === undefined || code === null ? '' : String(code);
  } catch {
    return '';
  }
}

function probeOpenAIWireApi(baseUrl, headers, protocol, probeModel) {
  // Coding Plan endpoints reject the generic gpt-4o-mini model; the caller
  // passes the plan-specific model via pickProbeModel so the probe is valid.
  const model = probeModel || pickProbeModel(baseUrl);
  const normalizedProtocol = protocol === 'responses' ? 'responses' : 'chat';
  if (normalizedProtocol === 'responses') {
    const url = baseUrl.replace(/\/+$/, '') + '/responses';
    const body = JSON.stringify({ model, max_output_tokens: 1, input: 'hi' });
    return httpRequest(url, { method: 'POST', headers, body, timeout: 10000 });
  }
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
  return httpRequest(url, { method: 'POST', headers, body, timeout: 10000 });
}

function probeQianfanCodingApi(baseUrl, headers) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = JSON.stringify({
    model: 'qianfan-code-latest',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  });
  return httpRequest(url, { method: 'POST', headers, body, timeout: 10000 });
}

function truncateBody(body) {
  if (!body) return '';
  const s = typeof body === 'string' ? body : String(body);
  if (s.length <= 200) return s;
  return s.slice(0, 200) + '...';
}

function httpRequest(url, options) {
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

// ── Vault group migration ────────────────────────────────────
// Remaps freeform group names to canonical "{平台} · {地域}" format.
// Matching is based on key name prefixes for 国内/国际 split.

function resolveCanonicalGroup(key) {
  const k = String(key || '').toUpperCase();

  // ── 国际大厂 ──
  if (k.startsWith('OPENAI_API_KEY') || k === 'OPENAI_API_KEY') return 'OpenAI';
  if (k.startsWith('ANTHROPIC')) return 'Anthropic';
  if (k.startsWith('GOOGLE') || k.startsWith('GEMINI')) return 'Google Gemini';
  if (k.startsWith('XAI_')) return 'xAI';
  if (k.startsWith('MISTRAL_')) return 'Mistral';

  // ── 智谱/Z.AI (国内国际分站,key 不通用) ──
  if (k.startsWith('ZAI_API_KEY') || k.startsWith('ZAI_')) return '智谱AI · 国际';
  if (k.startsWith('ZHIPU_') || k.startsWith('OKIT-ZHIPU') || k.startsWith('BIGMODEL_')) return '智谱AI · 国内';

  // ── MiniMax (国内国际分站) ──
  if (k.startsWith('MINIMAX_GLOBAL') || k.startsWith('OKIT-MINIMAX-GLOBAL')) return 'MiniMax · 国际';
  if (k.startsWith('MINIMAX_') || k.startsWith('OKIT-MINIMAX')) return 'MiniMax · 国内';

  // ── Kimi / Moonshot (国内国际分站) ──
  if (k.startsWith('MOONSHOT_GLOBAL')) return 'Kimi · 国际';
  if (k.startsWith('MOONSHOT_')) return 'Kimi · 国内';
  if (k.startsWith('KIMI_')) return 'Kimi · 国内';

  // ── 仅国内 ──
  if (k.startsWith('DEEPSEEK_') || k === 'OKIT-DEEPSEEK' || k.startsWith('DEEPSEEK')) return 'DeepSeek';
  if (k.startsWith('DASHSCOPE_')) return '阿里云百炼';
  if (k.startsWith('QIANFAN_') || k.startsWith('QIANFAN')) return '百度千帆';
  if (k.startsWith('VOLCENGINE_') || k === 'OKIT-VOLCENGINE' || k.startsWith('VOLC_')) return '火山引擎';
  if (k.startsWith('TENCENT_') || k.startsWith('TECENT_') || k.startsWith('TENCENT')) return '腾讯云';
  if (k.startsWith('STEPFUN_')) return '阶跃星辰';
  if (k.startsWith('XIAOMI_MIMO') || k.startsWith('XIAOMI_')) return '小米 MiMo';

  // ── 聚合/代理 ──
  if (k.startsWith('OPENROUTER_')) return 'OpenRouter';
  if (k.startsWith('SILICONFLOW_')) return '硅基流动';
  if (k.startsWith('OPENCODE_')) return 'OpenCode Go';

  // ── 基础设施 ──
  if (k.startsWith('CF_') || k.startsWith('CLOUDFLARE')) return 'Cloudflare';

  // ── 无法归类 ──
  return null;
}

async function migrateGroups(req, res) {
  try {
    await store.reload();
    const data = await store.load();
    const changes = [];
    let migrated = 0;

    for (const s of data.secrets) {
      const canonical = resolveCanonicalGroup(s.key);
      if (canonical && canonical !== s.group) {
        const from = s.group || '(ungrouped)';
        s.group = canonical;
        changes.push({ key: s.key, from, to: canonical });
        migrated++;
      }
    }

    if (migrated > 0) {
      await store.save();
      appendVaultLog('migrate-groups', '', true, `${migrated} keys regrouped`);
    }

    res.json({ success: true, migrated, changes });
  } catch (error) {
    appendVaultLog('migrate-groups', '', false, error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { listVault, setVault, deleteVault, exportVault, importVault, getVaultValue, syncVaultToProject, browseDirs, checkKeyImpact, listProjects, listVaultWithProjects, testApiKey, migrateGroups, autoSyncToPlatforms };
