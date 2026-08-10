// Usage / quota query for subscription-based providers and agents.
//
// Supports 6 providers that have a live API, all using existing credentials
// (no extra admin keys needed):
//
//   Codex (ChatGPT sub)  → OAuth token from ~/.codex/auth.json
//   Claude Code (sub)    → OAuth token from ~/.claude/.credentials.json
//   GLM Coding Plan      → Coding Plan API key (same as inference)
//   Kimi Coding Plan     → Coding Plan API key (same as inference)
//   MiniMax Token Plan   → Coding Plan API key (same as inference)
//   OpenRouter           → API key (same as inference)
//
// Unified response shape:
//   { providerId, supported: true, windows: [{ label, usedPercent, resetAt }], raw }
//
// Unsupported providers return { supported: false } so the UI can show a
// "console-only" hint without an error.

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const OKIT_DIR = path.join(os.homedir(), '.okit');
const PROVIDERS_PATH = path.join(OKIT_DIR, 'providers.json');

// Providers we can query. Keyed by provider preset id.
const SUPPORTED = new Set([
  'openai-codex',    // Codex (ChatGPT subscription)
  'anthropic',       // Claude Code (Pro/Max subscription) — only when OAuth
  'glm-coding',      // GLM Coding Plan
  'kimi-coding-plan',// Kimi Coding Plan
  'minimax-coding',  // MiniMax Token Plan
  'openrouter',      // OpenRouter
  'volcengine-coding', // 火山引擎 Coding Plan (needs AK/SK)
]);

async function loadProviders() {
  if (!(await fs.pathExists(PROVIDERS_PATH))) return [];
  try {
    const content = await fs.readFile(PROVIDERS_PATH, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    return [];
  }
}

async function resolveVaultKey(vaultKey) {
  if (!vaultKey) return undefined;
  try {
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    let value = await store.get(vaultKey);
    if (value) return value;
    const parsed = VaultStore.parseKeyAlias(vaultKey);
    return await store.resolve(parsed.key, parsed.alias);
  } catch {
    return undefined;
  }
}

// ── HTTP helper ──────────────────────────────────────────────

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
    req.setTimeout(options.timeout || 10000, () => {
      req.destroy();
      resolve({ status: 0, error: 'Timeout' });
    });
    req.end();
  });
}

// ── Per-provider queries ─────────────────────────────────────

// Codex (ChatGPT subscription) — undocumented internal endpoint used by the
// Codex CLI TUI. Returns 5h (primary) and weekly (secondary) usage windows.
async function queryCodexUsage() {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  if (!(await fs.pathExists(authPath))) {
    return { supported: true, windows: [], error: '尚未登录 ChatGPT (无 ~/.codex/auth.json)' };
  }
  const content = await fs.readFile(authPath, 'utf-8');
  const auth = JSON.parse(content);
  if (auth.auth_mode !== 'chatgpt' || !auth.tokens?.access_token) {
    return { supported: true, windows: [], error: '尚未登录 ChatGPT' };
  }
  const result = await httpRequest('https://chatgpt.com/backend-api/wham/usage', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${auth.tokens.access_token}`,
      'ChatGPT-Account-Id': auth.account_id || '',
      'User-Agent': 'codex-cli',
      'Accept': 'application/json',
    },
    timeout: 10000,
  });
  if (result.error) return { supported: true, windows: [], error: result.error };
  if (result.status === 401) return { supported: true, windows: [], error: 'OAuth Token 已过期，请重新登录' };
  if (result.status !== 200) return { supported: true, windows: [], error: `HTTP ${result.status}` };

  const d = JSON.parse(result.body);
  const windows = [];
  const rl = d.rate_limit || {};
  if (rl.primary_window) {
    windows.push({
      label: '5h',
      usedPercent: round1(rl.primary_window.used_percent),
      resetAt: rl.primary_window.reset_at ? epochToISO(rl.primary_window.reset_at) : null,
    });
  }
  if (rl.secondary_window) {
    windows.push({
      label: 'weekly',
      usedPercent: round1(rl.secondary_window.used_percent),
      resetAt: rl.secondary_window.reset_at ? epochToISO(rl.secondary_window.reset_at) : null,
    });
  }
  return { supported: true, windows, raw: d };
}

// Claude Code (Pro/Max subscription) — undocumented beta endpoint. Works with
// the OAuth token stored by `claude login`, NOT with an API key.
async function queryClaudeUsage(provider) {
  // Only attempt OAuth usage if the provider is NOT using an API key.
  // If authMode is api_key, fall through to "unsupported" for subscription query.
  if (provider.authMode === 'api_key') {
    return { supported: false };
  }

  // Try to read the OAuth token from ~/.claude/.credentials.json
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  let accessToken;
  if (await fs.pathExists(credPath)) {
    try {
      const cred = JSON.parse(await fs.readFile(credPath, 'utf-8'));
      accessToken = cred.access_token || cred.tokens?.access_token;
    } catch {}
  }

  // On macOS, Claude Code may store the token in Keychain instead.
  if (!accessToken && process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      const out = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (out) {
        const parsed = JSON.parse(out);
        accessToken = parsed.access_token || parsed.tokens?.access_token;
      }
    } catch {}
  }

  if (!accessToken) {
    return { supported: true, windows: [], error: '尚未登录 Claude (无 OAuth token)' };
  }

  const result = await httpRequest('https://api.anthropic.com/api/oauth/usage', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/1.0.0',
      'Accept': 'application/json',
    },
    timeout: 10000,
  });
  if (result.error) return { supported: true, windows: [], error: result.error };
  if (result.status === 401) return { supported: true, windows: [], error: 'OAuth Token 已过期，请重新登录' };
  if (result.status === 429) return { supported: true, windows: [], error: '请求过于频繁，请稍后重试 (429)' };
  if (result.status !== 200) return { supported: true, windows: [], error: `HTTP ${result.status}` };

  const d = JSON.parse(result.body);
  const windows = [];
  if (d.five_hour) {
    windows.push({
      label: '5h',
      usedPercent: round1((d.five_hour.utilization || 0) * 100),
      resetAt: d.five_hour.resets_at || null,
    });
  }
  if (d.seven_day) {
    windows.push({
      label: '7d',
      usedPercent: round1((d.seven_day.utilization || 0) * 100),
      resetAt: d.seven_day.resets_at || null,
    });
  }
  return { supported: true, windows, raw: d };
}

// GLM Coding Plan — official endpoint used by the zai-coding-plugins and
// cc-switch. Note: NO "Bearer" prefix (Zhipu quirk).
async function queryGlmCodingUsage(apiKey) {
  if (!apiKey) return { supported: true, windows: [], error: '无可用 API Key' };
  const result = await httpRequest('https://open.bigmodel.cn/api/monitor/usage/quota/limit', {
    method: 'GET',
    headers: { 'Authorization': apiKey },
    timeout: 10000,
  });
  if (result.error) return { supported: true, windows: [], error: result.error };
  if (result.status === 401) return { supported: true, windows: [], error: 'API Key 无效' };
  if (result.status !== 200) return { supported: true, windows: [], error: `HTTP ${result.status}` };

  const d = JSON.parse(result.body);
  const limits = d.data?.limits || [];
  const windows = limits.map(l => ({
    label: l.unit === 3 ? '5h' : l.unit === 6 ? 'weekly' : 'limit',
    usedPercent: round1(l.percentage),
    resetAt: l.nextResetTime ? epochToISO(l.nextResetTime) : null,
  }));
  return { supported: true, windows, raw: d };
}

// Kimi Coding Plan — official endpoint returning limit/remaining per window.
async function queryKimiCodingUsage(apiKey) {
  if (!apiKey) return { supported: true, windows: [], error: '无可用 API Key' };
  const result = await httpRequest('https://api.kimi.com/coding/v1/usages', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    timeout: 10000,
  });
  if (result.error) return { supported: true, windows: [], error: result.error };
  if (result.status === 401) return { supported: true, windows: [], error: 'API Key 无效' };
  if (result.status !== 200) return { supported: true, windows: [], error: `HTTP ${result.status}` };

  const d = JSON.parse(result.body);
  const windows = [];
  // limits[] = 5-hour window(s)
  if (Array.isArray(d.limits)) {
    for (const l of d.limits) {
      const det = l.detail || l;
      if (det.limit != null && det.remaining != null) {
        windows.push({
          label: '5h',
          usedPercent: round1(((det.limit - det.remaining) / det.limit) * 100),
          resetAt: det.resetTime || null,
        });
      }
    }
  }
  // usage = weekly window
  if (d.usage && d.usage.limit != null && d.usage.remaining != null) {
    windows.push({
      label: 'weekly',
      usedPercent: round1(((d.usage.limit - d.usage.remaining) / d.usage.limit) * 100),
      resetAt: d.usage.resetTime || null,
    });
  }
  return { supported: true, windows, raw: d };
}

// MiniMax Token Plan — official endpoint returning remaining percent.
async function queryMinimaxCodingUsage(apiKey) {
  if (!apiKey) return { supported: true, windows: [], error: '无可用 API Key' };
  const result = await httpRequest('https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    timeout: 10000,
  });
  if (result.error) return { supported: true, windows: [], error: result.error };
  if (result.status === 401) return { supported: true, windows: [], error: 'API Key 无效' };
  if (result.status !== 200) return { supported: true, windows: [], error: `HTTP ${result.status}` };

  const d = JSON.parse(result.body);
  const remains = d.model_remains || [];
  const windows = [];
  for (const r of remains) {
    if (r.model_name !== 'general') continue; // skip "video" etc.
    if (r.current_interval_remaining_percent != null) {
      windows.push({
        label: '5h',
        usedPercent: round1(100 - r.current_interval_remaining_percent),
        resetAt: r.end_time ? epochToISO(r.end_time) : null,
      });
    }
    if (r.current_weekly_status === 1 && r.current_weekly_remaining_percent != null) {
      windows.push({
        label: 'weekly',
        usedPercent: round1(100 - r.current_weekly_remaining_percent),
        resetAt: r.weekly_end_time ? epochToISO(r.weekly_end_time) : null,
      });
    }
  }
  return { supported: true, windows, raw: d };
}

// OpenRouter — returns remaining credits / usage directly.
async function queryOpenRouterUsage(apiKey) {
  if (!apiKey) return { supported: true, windows: [], error: '无可用 API Key' };
  const result = await httpRequest('https://openrouter.ai/api/v1/key', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    timeout: 10000,
  });
  if (result.error) return { supported: true, windows: [], error: result.error };
  if (result.status === 401) return { supported: true, windows: [], error: 'API Key 无效' };
  if (result.status !== 200) return { supported: true, windows: [], error: `HTTP ${result.status}` };

  const d = JSON.parse(result.body);
  const data = d.data || d;
  const usage = data.usage || 0;
  const limit = data.limit;
  const usagePercent = limit ? round1((usage / limit) * 100) : null;
  return {
    supported: true,
    windows: [{
      label: 'credits',
      usedPercent: usagePercent,
      usedCredits: round4(usage),
      limitCredits: limit != null ? round4(limit) : null,
      remainingCredits: limit != null ? round4(limit - usage) : null,
      isPrepaid: limit == null,
    }],
    raw: d,
  };
}

// 火山引擎 Coding Plan — requires AK/SK with ark:Read permission.
// Uses Volcengine Signature V4 (a variant of AWS SigV4) on the control-plane
// gateway open.volcengineapi.com. The inference API key cannot be used here.
// Probes GetAFPUsage (Agent Plan) first, falls back to GetCodingPlanUsage.
async function queryVolcengineCodingUsage() {
  // Resolve AK/SK from vault. These are typically stored under VOLC_KMS_ACCESS_KEY
  // or a dedicated VOLC_ARK_AK / VOLC_ARK_SK pair.
  let ak = await resolveVaultKey('VOLC_ARK_AK') || await resolveVaultKey('VOLC_ARK_AK-default');
  let sk = await resolveVaultKey('VOLC_ARK_SK') || await resolveVaultKey('VOLC_ARK_SK-default');
  // Fallback: try the KMS AK/SK (works if the IAM user has ark permissions too)
  if (!ak) ak = await resolveVaultKey('VOLC_KMS_ACCESS_KEY') || await resolveVaultKey('VOLC_KMS_ACCESS_KEY/火山引擎KMS Access Key');
  if (!sk) sk = await resolveVaultKey('VOLC_KMS_SECRET_KEY') || await resolveVaultKey('VOLC_KMS_SECRET_KEY/火山引擎KMS Secret Access key');
  if (!ak || !sk) return { supported: true, windows: [], error: '未找到火山引擎 AK/SK，请在密钥管理中添加 VOLC_ARK_AK 和 VOLC_ARK_SK' };

  // Try GetAFPUsage (Agent Plan) first — returns absolute quotas.
  const afpResult = await callVolcApi(ak, sk, 'GetAFPUsage');
  if (afpResult.error) return { supported: true, windows: [], error: afpResult.error };
  if (afpResult.status === 403) return { supported: true, windows: [], error: 'AK/SK 无 ark 服务权限，请授予 ArkReadOnlyAccess' };

  if (afpResult.status === 200) {
    const afpData = JSON.parse(afpResult.body);
    const result = afpData.Result || {};
    // If Agent Plan has non-zero quota, use it.
    if (result.AFPFiveHour && result.AFPFiveHour.Quota > 0) {
      const windows = [];
      const tiers = [
        { key: 'AFPFiveHour', label: '5h' },
        { key: 'AFPWeekly', label: 'weekly' },
        { key: 'AFPMonthly', label: 'monthly' },
      ];
      for (const tier of tiers) {
        const w = result[tier.key];
        if (w && w.Quota > 0) {
          windows.push({
            label: tier.label,
            usedPercent: round1((w.Used / w.Quota) * 100),
            resetAt: w.ResetTime ? epochToISO(w.ResetTime) : null,
          });
        }
      }
      if (windows.length) return { supported: true, windows, raw: afpData };
    }
  }

  // Fallback: GetCodingPlanUsage — returns percentages.
  const cpResult = await callVolcApi(ak, sk, 'GetCodingPlanUsage');
  if (cpResult.error) return { supported: true, windows: [], error: cpResult.error };
  if (cpResult.status !== 200) {
    if (cpResult.status === 403) return { supported: true, windows: [], error: 'AK/SK 无 ark 服务权限' };
    return { supported: true, windows: [], error: `HTTP ${cpResult.status}` };
  }

  const cpData = JSON.parse(cpResult.body);
  const cpResult2 = cpData.Result || {};
  const quotaUsage = cpResult2.QuotaUsage || [];
  const windows = quotaUsage.map(q => ({
    label: q.Level === 'session' ? '5h' : q.Level === 'weekly' ? 'weekly' : q.Level === 'monthly' ? 'monthly' : q.Level,
    // Percent is a 0-1 decimal, multiply by 100.
    usedPercent: round1((q.Percent || 0) * 100),
    resetAt: q.ResetTimestamp ? epochToISO(q.ResetTimestamp) : null,
  })).filter(w => w.usedPercent !== null);

  return { supported: true, windows, raw: cpData };
}

// Volcengine Signature V4 signer + API caller.
function callVolcApi(ak, sk, action) {
  const crypto = require('crypto');
  return new Promise(resolve => {
    const now = new Date();
    const xDate = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const shortDate = xDate.slice(0, 8);
    const region = 'cn-beijing';
    const service = 'ark';
    const host = 'open.volcengineapi.com';
    const canonicalQuery = `Action=${action}&Region=${region}&Version=2024-01-01`;
    const body = '';
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const signedHeaders = 'host;x-content-sha256;x-date';
    const canonicalHeaders = `host:${host}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`;
    const canonicalRequest = `POST\n/\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;
    const credentialScope = `${shortDate}/${region}/${service}/request`;
    const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

    // Volcengine variant: kDate = HMAC(SK, date) — no prefix, no AWS4.
    const kDate = crypto.createHmac('sha256', sk).update(shortDate).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization = `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const req = require('https').request(`https://${host}/?${canonicalQuery}`, {
      method: 'POST',
      headers: { Host: host, 'X-Date': xDate, 'X-Content-Sha256': bodyHash, Authorization: authorization, 'Content-Type': 'application/json' },
      timeout: 10000,
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', err => resolve({ error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
}

// ── Dispatcher ───────────────────────────────────────────────

async function queryUsage(providerId) {
  // OAuth-based agents — read token from disk, no vault key needed.
  if (providerId === 'openai-codex') {
    return queryCodexUsage();
  }

  const providers = await loadProviders();
  const provider = providers.find(p => p.id === providerId);
  if (!provider) {
    return { supported: false, error: 'Provider 不存在' };
  }

  // Claude subscription uses OAuth, not the vault key.
  if (providerId === 'anthropic') {
    return queryClaudeUsage(provider);
  }

  // Volcengine Coding Plan needs AK/SK (control-plane SigV4), not the inference key.
  if (providerId === 'volcengine-coding') {
    return queryVolcengineCodingUsage();
  }

  // API-key-based providers — resolve key from vault.
  const apiKey = provider.vaultKey ? await resolveVaultKey(provider.vaultKey) : undefined;

  switch (providerId) {
    case 'glm-coding':
      return queryGlmCodingUsage(apiKey);
    case 'kimi-coding-plan':
      return queryKimiCodingUsage(apiKey);
    case 'minimax-coding':
      return queryMinimaxCodingUsage(apiKey);
    case 'openrouter':
      return queryOpenRouterUsage(apiKey);
    default:
      return { supported: false };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function round1(n) { return Math.round((n || 0) * 10) / 10; }
function round4(n) { return Math.round((n || 0) * 10000) / 10000; }
function epochToISO(ts) {
  // Accept epoch seconds or epoch millis.
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toISOString();
}

// ── Express handler ──────────────────────────────────────────

async function getUsage(req, res) {
  const { providerId } = req.params;
  if (!providerId) {
    return res.status(400).json({ error: 'providerId required' });
  }
  try {
    const result = await queryUsage(providerId);
    res.json(result);
  } catch (err) {
    res.json({ supported: false, error: err.message });
  }
}

// Returns the set of provider IDs that support usage queries, so the
// frontend can decide whether to show a "usage" button per provider.
function getSupportedUsageProviders(_req, res) {
  res.json({ providers: Array.from(SUPPORTED) });
}

module.exports = { getUsage, getSupportedUsageProviders, queryUsage };
