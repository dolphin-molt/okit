const { VaultStore } = require('../../vault/store');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const store = new VaultStore();

const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

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
  const { execSync } = require('child_process');
  const projects = [];

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const result = execSync(
        `find "${base}" -maxdepth 3 -name ".okitenv" -o -name ".okit-env" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (!result) continue;
      for (const file of result.split('\n')) {
        if (!file) continue;
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
  const os = require('os');
  const home = os.homedir();
  const glob = require('child_process');

  try {
    // Search common project directories for .okitenv files
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      // Use find to locate .okitenv files
      const result = glob.execSync(
        `find "${base}" -maxdepth 3 -name ".okitenv" -o -name ".okit-env" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (!result) continue;
      for (const file of result.split('\n')) {
        if (!file) continue;
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
  const os = require('os');
  const home = os.homedir();
  const glob = require('child_process');

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const result = glob.execSync(
        `find "${base}" -maxdepth 3 -name ".okitenv" -o -name ".okit-env" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (!result) continue;
      for (const file of result.split('\n')) {
        if (!file) continue;
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

    // Group secrets by key
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.key)) groups.set(e.key, []);
      groups.get(e.key).push(e);
    }

    // Attach bindings to each key
    const secrets = [];
    for (const [key, aliases] of groups) {
      const keyBindings = bindings.filter(b => b.key === key);
      secrets.push({ key, aliases, group: aliases[0]?.group || '', expiresAt: aliases[0]?.expiresAt || '', bindings: keyBindings });
    }

    res.json({ secrets, totalBindings: bindings.length });
  } catch (error) {
    console.error('Error listing vault:', error);
    res.status(500).json({ error: 'Failed to list vault' });
  }
}

async function setVault(req, res) {
  try {
    const { key, alias, value, group, expiresAt, originalKey, originalAlias } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    const keyAlias = alias && alias !== 'default' ? `${key}/${alias}` : key;
    const oldKeyAlias = originalKey
      ? (originalAlias && originalAlias !== 'default' ? `${originalKey}/${originalAlias}` : originalKey)
      : keyAlias;
    const isEditMove = originalKey && oldKeyAlias !== keyAlias;

    if (isEditMove) {
      const oldValue = await store.get(oldKeyAlias);
      if (oldValue === null) {
        return res.status(404).json({ error: 'Original secret not found' });
      }

      const existingTarget = await store.get(keyAlias);
      if (existingTarget !== null) {
        return res.status(409).json({ error: 'Target secret already exists' });
      }
    }

    await store.set(keyAlias, value, group, expiresAt);
    if (isEditMove) {
      await store.delete(oldKeyAlias);
      touchOkitEnvFiles(originalKey);
    }
    touchOkitEnvFiles(key);
    appendVaultLog('vault-set', keyAlias, true);
    res.json({ success: true, key, alias: alias || 'default' });

    // Auto-sync to enabled platforms (fire-and-forget)
    autoSyncToPlatforms(key, value);
  } catch (error) {
    console.error('Error setting vault:', error);
    appendVaultLog('vault-set', req.body.key || '', false, error.message);
    res.status(500).json({ error: 'Failed to set secret' });
  }
}

async function deleteVault(req, res) {
  try {
    const { key, alias } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const keyAlias = alias && alias !== 'default' ? `${key}/${alias}` : key;
    const deleted = await store.delete(keyAlias);
    if (deleted) {
      removeKeyFromOkitEnvFiles(key);
      appendVaultLog('vault-delete', keyAlias, true);
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
      const keyAlias = s.alias && s.alias !== 'default' ? `${s.key}/${s.alias}` : s.key;
      const existing = await store.get(keyAlias);
      if (existing) { skipped++; continue; }
      if (s.value) {
        await store.set(keyAlias, s.value, s.group, s.expiresAt);
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
    const { key, alias } = req.query;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const keyAlias = alias && alias !== 'default' ? `${key}/${alias}` : key;
    const value = await store.get(keyAlias);
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
      const keyAlias = item.alias && item.alias !== 'default' ? `${item.key}/${item.alias}` : item.key;
      const value = await store.get(keyAlias);
      if (value === null) {
        results.push({ key: item.key, success: false, error: '密钥不存在' });
        continue;
      }
      const envKey = item.key;
      if (!existingKeys.has(envKey)) {
        if (item.alias && item.alias !== 'default') {
          content = content.trimEnd() + (content.length > 0 ? '\n' : '') + `${envKey}: ${keyAlias}\n`;
        } else {
          content = content.trimEnd() + (content.length > 0 ? '\n' : '') + `${envKey}\n`;
        }
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
  const { execSync } = require('child_process');
  const projects = [];

  try {
    const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
    for (const dir of dirs) {
      const base = path.join(home, dir);
      if (!fs.existsSync(base)) continue;
      const result = execSync(
        `find "${base}" -maxdepth 3 -name ".okitenv" -o -name ".okit-env" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (!result) continue;
      for (const file of result.split('\n')) {
        if (!file) continue;
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
    const { execSync } = require('child_process');
    const keyProjects = {}; // key → [{path, name}]

    try {
      const dirs = ['Desktop', 'Documents', 'Projects', 'dev'];
      for (const dir of dirs) {
        const base = path.join(home, dir);
        if (!fs.existsSync(base)) continue;
        const result = execSync(
          `find "${base}" -maxdepth 3 -name ".okitenv" -o -name ".okit-env" 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        if (!result) continue;
        for (const file of result.split('\n')) {
          if (!file) continue;
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
              // Extract vault key from source (strip alias)
              const slashIdx = source.indexOf('/');
              const vaultKey = slashIdx > 0 ? source.slice(0, slashIdx) : source;
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

    // Group secrets by key and attach projects
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.key)) groups.set(e.key, []);
      groups.get(e.key).push(e);
    }

    const secrets = [];
    for (const [key, aliases] of groups) {
      secrets.push({
        key,
        aliases,
        group: aliases[0]?.group || '',
        expiresAt: aliases[0]?.expiresAt || '',
        projects: keyProjects[key] || [],
      });
    }

    res.json({ secrets, totalBindings: bindings.length });
  } catch (error) {
    console.error('Error listing vault:', error);
    res.status(500).json({ error: 'Failed to list vault' });
  }
}

async function autoSyncToPlatforms(key, value) {
  try {
    const configPath = path.join(os.homedir(), '.okit', 'user.json');
    if (!fs.existsSync(configPath)) return;
    const config = await fs.readJson(configPath);
    const sync = config.sync;
    if (!sync?.autoSync || !sync.platforms) return;

    const secret = { key, value };
    for (const [platformId, platConfig] of Object.entries(sync.platforms)) {
      if (!platConfig.enabled) continue;
      try {
        const adapter = require(`./platform-adapters/${platformId}`);
        const results = await adapter.syncSecrets(platConfig, [secret]);
        const failed = results.filter(r => !r.success);
        if (failed.length === 0) {
          appendVaultLog('auto-sync', `${key} → ${adapter.name}`, true);
        } else {
          appendVaultLog('auto-sync', `${key} → ${adapter.name}`, false, failed.map(r => r.error).join('; '));
        }
      } catch (error) {
        appendVaultLog('auto-sync', `${key} → ${platformId}`, false, error.message);
      }
    }
  } catch {}
}

async function testApiKey(req, res) {
  const { baseUrl, type, keyValue, vaultKey } = req.body;
  if (!baseUrl) {
    return res.status(400).json({ success: false, message: '缺少 baseUrl' });
  }

  let resolvedKey = keyValue;
  if (!resolvedKey && vaultKey) {
    try {
      await store.reload();
      resolvedKey = await store.resolve(vaultKey);
    } catch (err) {
      console.error('resolveVaultKey error:', err);
    }
  }
  if (!resolvedKey) {
    return res.json({ success: false, message: '无可用密钥，请先绑定 API Key' });
  }

  try {
    let url;
    const headers = {};

    if (type === 'anthropic') {
      url = `${baseUrl}/v1/messages`;
      headers['x-api-key'] = resolvedKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['content-type'] = 'application/json';
      const body = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
      const result = await httpRequest(url, { method: 'POST', headers, body, timeout: 10000 });
      if (result.error) return res.json({ success: false, message: `连接失败: ${result.error}` });
      if (result.status === 401) return res.json({ success: false, message: 'API Key 无效' });
      if (result.status === 200 || result.status === 400) return res.json({ success: true, message: '连接成功，Key 有效' });
      return res.json({ success: false, message: `HTTP ${result.status}: ${truncateBody(result.body)}` });
    } else if (type === 'google') {
      url = `${baseUrl}/v1beta/models?key=${resolvedKey}`;
      const result = await httpRequest(url, { method: 'GET', timeout: 10000 });
      if (result.error) return res.json({ success: false, message: `连接失败: ${result.error}` });
      if (result.status === 400 || result.status === 403) return res.json({ success: false, message: 'API Key 无效' });
      if (result.status === 200) return res.json({ success: true, message: '连接成功，Key 有效' });
      return res.json({ success: false, message: `HTTP ${result.status}: ${truncateBody(result.body)}` });
    } else {
      // openai compatible — try /models first, fallback to /chat/completions probe
      headers['Authorization'] = `Bearer ${resolvedKey}`;
      headers['content-type'] = 'application/json';
      url = baseUrl.replace(/\/+$/, '') + '/models';
      let result = await httpRequest(url, { method: 'GET', headers, timeout: 10000 });

      if (result.error) {
        // Connection failed entirely, try /chat/completions as fallback
        url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const probeBody = JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
        result = await httpRequest(url, { method: 'POST', headers, body: probeBody, timeout: 10000 });
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
        // /models not available, try chat probe
        url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const probeBody = JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
        const probeResult = await httpRequest(url, { method: 'POST', headers, body: probeBody, timeout: 10000 });
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

module.exports = { listVault, setVault, deleteVault, exportVault, importVault, getVaultValue, syncVaultToProject, browseDirs, checkKeyImpact, listProjects, listVaultWithProjects, testApiKey };
