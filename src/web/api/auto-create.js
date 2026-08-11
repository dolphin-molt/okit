/**
 * Auto-create API keys for supported platforms.
 * Cloudflare: REST API (POST /client/v4/user/tokens)
 * Volcengine / Zhipu / MiniMax: Chrome Extension browser automation
 */

const https = require('https');
const { sendCommand, sendToExtension, isExtensionConnected } = require('./ws-extension');

// ─── Cloudflare REST API ───────────────────────────────────────────

async function createCloudflareToken({ parentToken, tokenName }) {
  const body = JSON.stringify({
    name: tokenName,
    policies: [{
      effect: 'allow',
      permission_groups: [
        { id: 'c8fed203ed3043cba015a93ad1616f1f' },
        { id: '82e64a83756745bbbb1c9c2701bf816b' },
      ],
      resources: { 'com.cloudflare.api.account.*': '*' },
    }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: '/client/v4/user/tokens',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${parentToken}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) resolve({ value: json.result.value, name: json.result.name, id: json.result.id });
          else reject(new Error(json.errors?.[0]?.message || 'Cloudflare API error'));
        } catch { reject(new Error('Failed to parse Cloudflare response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Zhipu (智谱AI) — atomic-capability orchestration ──────────────
// Orchestrates the zhipu API key creation flow by composing generic
// extension atoms (navigate / exec / network-capture-*). The extension
// knows nothing about zhipu — all platform specifics live here.
//
// Flow: navigate → arm network capture → dismiss popups → click "create"
//       → fill name → click "confirm" → read captured API response → extract key.

// Selectors derived from the proven Playwright script (src/scripts/auto-create-key.mjs).
const ZHIPU_URL = 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys';
const ZHIPU_CREATE_TEXTS = ['新建API Key', '添加新的', '创建新', '新建'];
const ZHIPU_CONFIRM_TEXTS = ['确定', '确认', '创建', '保存'];
const ZHIPU_NAME_SELECTORS = 'input[placeholder*="名称"],input[placeholder*="描述"],input[id*="name"]';

/** Sleep helper that keeps the extension SW alive during long waits.
 *  MV3 service workers are killed after ~30s of inactivity. During long SPA
 *  load waits (e.g. volcengine's 8s extraWait), we must periodically send a
 *  lightweight command so Chrome considers the SW active. This function pings
 *  the extension every 5s during the wait. If the extension is disconnected,
 *  the ping is silently skipped (we can't keep it alive if it's already dead). */
async function sleep(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const wait = Math.min(remaining, 5000);
    await new Promise(r => setTimeout(r, wait));
    // Ping the extension to keep the SW alive (only if there's more to wait)
    if (Date.now() < deadline && isExtensionConnected()) {
      try {
        await sendCommand('exec', { code: '1', workspace: 'okit' }, 3000);
      } catch { /* ignore ping failures */ }
    }
  }
}

/** Run an exec atom on the automation tab. Returns the JS result value. */
async function execJs(code, timeoutMs = 15000) {
  const r = await sendCommand('exec', { code, workspace: 'okit' }, timeoutMs);
  if (!r.ok) throw new Error(r.error || 'exec failed');
  return r.data;
}

/** Close the automation Chrome window to avoid leaving stray windows open.
 *  Silently ignored if the window is already gone or the extension disconnected. */
async function closeAutomationWindow() {
  try {
    await sendCommand('close-window', { workspace: 'okit' }, 5000);
  } catch { /* window may already be closed — ignore */ }
}

/** Put the dedicated Chrome automation window in front for a login handoff.
 *  Failure is non-fatal: the UI can still tell the user where to finish login. */
async function focusAutomationWindow() {
  try {
    const result = await sendCommand('focus-window', { workspace: 'okit', hold: true }, 5000);
    return Boolean(result.ok);
  } catch {
    return false;
  }
}

/** Click a verified provider control with trusted foreground input. */
async function foregroundClick({ x, y, tabId }) {
  const pointer = { x: Number(x), y: Number(y), button: 'left', buttons: 1, clickCount: 1 };
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return false;
  const focused = await sendCommand('focus-window', { workspace: 'okit' }, 5000).catch(() => ({ ok: false }));
  if (!focused.ok) return false;
  await sleep(150);
  const pressed = await sendCommand('cdp', {
    cdpMethod: 'Input.dispatchMouseEvent',
    cdpParams: { ...pointer, type: 'mousePressed' },
    workspace: 'okit',
    ...(tabId ? { tabId } : {}),
  }, 5000).catch(() => ({ ok: false }));
  const released = await sendCommand('cdp', {
    cdpMethod: 'Input.dispatchMouseEvent',
    cdpParams: { ...pointer, type: 'mouseReleased', buttons: 0 },
    workspace: 'okit',
    ...(tabId ? { tabId } : {}),
  }, 5000).catch(() => ({ ok: false }));
  return Boolean(pressed.ok && released.ok);
}

function isLoginFailure(message) {
  return /login|log\s*in|sign\s*in|continue with (?:google|email|sso)|未登录|登录|401|authentication required/i.test(message || '');
}

function isLoginUrl(url) {
  return /\/(?:login|log-in|sign-in|signin|auth)(?:[/?#]|$)/i.test(url || '');
}

/**
 * Some platforms redirect to a login page without returning a useful API
 * error. Probe only stable, non-sensitive page signals so the UI can hand the
 * browser over to the user instead of reporting a vague creation failure.
 */
async function detectLoginRequired() {
  try {
    const raw = await execJs(`(() => {
      const isVisible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const url = location.href;
      const loginRoute = /(?:login|signin|sign-in|auth)(?:[/?#]|$)/i.test(url);
      const hasPasswordField = [...document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]')]
        .some(isVisible);
      const bodyText = (document.body?.innerText || '').slice(0, 12000);
      const hasLoginPrompt = /请(?:先)?登录|登录后(?:继续|使用)|请登录(?:后)?|sign in to continue|log in to continue|please sign in|authentication required/i.test(bodyText);
      const hasLoginAction = [...document.querySelectorAll('a, button, [role="button"]')]
        .filter(isVisible)
        .some((el) => /^(?:登录|登入|sign in|log in)$/i.test((el.textContent || '').trim()));
      return JSON.stringify({ loginRequired: loginRoute || hasPasswordField || (hasLoginPrompt && hasLoginAction), url });
    })()`);
    const state = JSON.parse(raw || '{}');
    return { loginRequired: Boolean(state.loginRequired), url: typeof state.url === 'string' ? state.url : undefined };
  } catch {
    return { loginRequired: false, url: undefined };
  }
}

function isOpenRouterPublicPage(state) {
  return Boolean(state?.publicHome && !state?.keyWorkspace);
}

function hasOpenRouterPublicNavigation(labels) {
  return ['Home', 'Models', 'Fusion', 'Chat'].every((label) => labels.includes(label));
}

async function redirectOpenRouterToLogin() {
  const signInUrl = 'https://openrouter.ai/sign-in?redirect_url=https%3A%2F%2Fopenrouter.ai%2Fworkspaces%2Fdefault%2Fkeys';
  await sendCommand('navigate', { url: signInUrl, workspace: 'okit' }, 30000).catch(() => {});
}

/**
 * OpenRouter can fall back to its public home page instead of exposing a
 * conventional password form. Treat that as a login handoff, not as a missing
 * "Create Key" button. Only non-sensitive booleans and the current URL cross
 * the extension boundary.
 */
async function handoffOpenRouterLoginIfNeeded() {
  const raw = await execJs(`(() => {
    const url = location.href;
    const text = (document.body?.innerText || '').slice(0, 16000);
    const labels = [...document.querySelectorAll('a, button, [role="button"]')]
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    const publicNavigation = ['Home', 'Models', 'Fusion', 'Chat']
      .every((label) => labels.includes(label));
    return JSON.stringify({
      url,
      // The public shell sometimes preserves /keys in the address bar while
      // rendering only its Home/Models/Fusion/Chat navigation. That navigation
      // pattern itself is the reliable unauthenticated signal.
      publicHome: /The Unified Interface For LLMs|Get API Key/.test(text) || publicNavigation,
      keyWorkspace: /\\/workspaces\\/[^/]+\\/keys(?:[/?#]|$)/.test(location.pathname),
    });
  })()`);
  const state = JSON.parse(raw || '{}');
  if (isLoginUrl(state.url) || isOpenRouterPublicPage(state)) {
    if (!isLoginUrl(state.url)) {
      await redirectOpenRouterToLogin();
    }
    throw new Error(`OpenRouter login required${state.url ? ` (${state.url})` : ''}`);
  }
}

/** Extract a real API key from captured network responses.
 *  Tries common field names + a JWT/hex fallback. Mirrors the Playwright regex.
 *  For zhipu: keys are in "AK_ID.SK" format (e.g. "53f6...123.i2IC...xOe"),
 *  so we look for both the id and secret fields and join them with ".". */
function extractKeyFromCaptures(entries, platform) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  // Look at response bodies (responsePreview), prefer JSON bodies
  const candidates = [];
  for (const e of entries) {
    const body = e.responsePreview || '';
    if (!body || body.startsWith('base64:')) continue;
    candidates.push({
      body,
      url: e.url || '',
      method: String(e.method || '').toUpperCase(),
      timestamp: Number(e.timestamp) || 0,
      status: e.responseStatus,
    });
  }

  // 1. Try parsing JSON bodies and pluck known key fields.
  //    For zhipu, the response has separate "api_key" and "api_secret" fields
  //    that must be joined as "api_key.api_secret".
  //    IMPORTANT: prefer POST responses (create API) over GET (list API), since
  //    the list API returns masked secrets while the create API has the full key.
  const sortedCandidates = [...candidates].sort((a, b) => {
    // The post-create secret is returned by the mutation. Page bootstrap
    // requests can also contain fields named `key` (for example, a session
    // public key), so they must never win over the create response.
    const aMutation = /^(POST|PUT|PATCH)$/i.test(a.method) ? 0 : 1;
    const bMutation = /^(POST|PUT|PATCH)$/i.test(b.method) ? 0 : 1;
    return aMutation - bMutation || b.timestamp - a.timestamp;
  });
  for (const c of sortedCandidates) {
    let data;
    try { data = JSON.parse(c.body); } catch { continue; }

    // Diagnostic only: never log an API response body because this path is
    // expected to contain a newly-created secret.
    if (/api_key|api_secret|apikey|secret/i.test(c.body)) {
      console.log(`[auto-create] key-containing response captured from ${c.url.slice(0, 80)}`);
    }

    // Several providers return a key as two fields. Z.AI's live API may name
    // these apiKeyId/apiKeySecret rather than apiKey/secretKey, so keep the
    // accepted aliases explicit and pair them only within this captured
    // creation response. Masked list values are rejected below.
    const keyId = findFieldValue(data, [
      'api_key', 'apikey', 'api_key_id', 'apikeyid', 'key_id', 'keyid', 'key',
    ]);
    const secret = findFieldValue(data, [
      'api_secret', 'apikeysecret', 'api_key_secret', 'apikey_secret',
      'secret_key', 'secretkey', 'signature_secret', 'signaturesecret', 'secret',
    ]);
    if (keyId && secret && !isAssetData(keyId) && !isAssetData(secret)) {
      return keyId + '.' + secret;
    }

    // Generic: single key-like field
    const found = findKeyField(data);
    if (found && !isAssetData(found)) return found;

    // Z.AI may return the complete API key in a provider-specific field rather
    // than a field literally named key or secret. Inspect only JSON string
    // values from this captured create response for its documented id.secret
    // structure; URLs and other non-JSON text are deliberately excluded.
    if (platform === 'zai-global') {
      const joined = findIdSecretValue(data);
      if (joined && !isAssetData(joined)) return joined;
    }
  }

  // 2. Regex fallback over raw bodies (catches embedded JSON or JWTs)
  for (const c of candidates) {
    const m = c.body.match(/"(?:key|api_key|apiKey|token|value|secret)"\s*:\s*"([^"]{20,})"/);
    if (m && !isAssetData(m[1])) return m[1];
  }
  for (const c of candidates) {
    const m = c.body.match(/eyJ[a-zA-Z0-9\-_]{50,}/);
    if (m && !isAssetData(m[0])) return m[0];
  }
  // zhipu: full key format is 32-hex-dot-alphanumeric (e.g. xxxx.i2IC1jQ...)
  for (const c of candidates) {
    const m = c.body.match(/\b([a-f0-9]{32}\.[a-zA-Z0-9]{8,})\b/);
    if (m && !isAssetData(m[1])) return m[1];
  }
  for (const c of candidates) {
    // zhipu captured example: 32-char hex like a7cb939127954e91bd78d1cac4a1ee8f
    const m = c.body.match(/\b([a-f0-9]{32})\b/);
    if (m && !isAssetData(m[1])) return m[1];
  }

  return null;
}

/** Find a field value by checking a list of candidate field names (case-insensitive). */
function findFieldValue(obj, fieldNames, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  const lowerNames = fieldNames.map(f => f.toLowerCase());
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length >= 8 && lowerNames.includes(k.toLowerCase())) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findFieldValue(v, fieldNames, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Recursively search a JSON object for a key-like field. */
function findKeyField(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  const KEY_NAMES = ['apikey', 'api_key', 'apikeysecret', 'accesskey', 'access_key', 'key', 'token', 'value', 'secret', 'secret_key'];
  for (const [k, v] of Object.entries(obj)) {
    const lk = String(k).toLowerCase();
    if (typeof v === 'string' && v.length >= 20 && KEY_NAMES.includes(lk)) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findKeyField(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Find a Z.AI id.secret value in JSON data without logging or otherwise
 * exposing the response. The two segments cannot contain whitespace or a
 * second dot, matching Z.AI's documented split('.') authentication format. */
function findIdSecretValue(obj, depth = 0) {
  if (depth > 6 || obj === null || obj === undefined) return null;
  if (typeof obj === 'string') {
    const match = obj.match(/^([^.\s]{8,128}\.[^.\s]{8,256})$/);
    return match ? match[1] : null;
  }
  if (typeof obj !== 'object') return null;
  for (const value of Object.values(obj)) {
    const found = findIdSecretValue(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Safe diagnostics for a failed one-time-secret extraction. Provider API
 * responses may contain credentials, so this reports field paths, lengths and
 * coarse shapes only — never a response value or a response body.
 */
function describeCapturedSecretFields(entries) {
  const summaries = [];
  const visit = (value, path = '', depth = 0, output = []) => {
    if (depth > 6 || output.length >= 16 || value === null || value === undefined) return output;
    if (typeof value === 'string') {
      const field = path.split('.').pop() || '';
      if (/api.?key|secret|token|access.?key|credential/i.test(field)) {
        output.push({
          field: path,
          length: value.length,
          shape: /^[a-f0-9]{32}\./i.test(value) ? 'id.secret'
            : /^sk-/i.test(value) ? 'sk-prefix'
              : /^[a-f0-9]{32}$/i.test(value) ? 'hex-id'
                : 'other',
        });
      }
      return output;
    }
    if (typeof value !== 'object') return output;
    for (const [key, nested] of Object.entries(value)) {
      visit(nested, path ? `${path}.${key}` : key, depth + 1, output);
      if (output.length >= 16) break;
    }
    return output;
  };

  for (const entry of entries || []) {
    const body = entry?.responsePreview || '';
    if (!body || body.startsWith('base64:')) continue;
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    const fields = visit(data);
    if (!fields.length) continue;
    let path = String(entry.url || '');
    try { path = new URL(path).pathname; } catch {}
    summaries.push({ method: String(entry.method || 'GET').toUpperCase(), status: entry.responseStatus || 0, path: path.slice(0, 120), fields });
    if (summaries.length >= 6) break;
  }
  return summaries;
}

/** Safe shape-only diagnostics for captured responses. Never include response
 * values, headers, request bodies, or any credential-bearing text. */
function describeCapturedResponses(entries) {
  return (entries || []).slice(-12).map((entry) => {
    const body = String(entry?.responsePreview || '');
    let jsonKeys = [];
    if (body && !body.startsWith('base64:')) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          jsonKeys = Object.keys(parsed).slice(0, 24);
        }
      } catch {}
    }
    let path = String(entry?.url || '');
    try { path = new URL(path).pathname; } catch {}
    return {
      method: String(entry?.method || 'GET').toUpperCase(),
      status: Number(entry?.responseStatus) || 0,
      path: path.slice(0, 160),
      bodyLength: body.length,
      jsonKeys,
    };
  });
}

/** Return only whether a provider redacted a returned secret. This is
 * deliberately boolean-only: diagnostics must never surface credentials. */
function capturesContainMaskedSecret(entries) {
  const visit = (value, field = '', depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
      return /secret|signature/i.test(field) && /[＊*•]/.test(value);
    }
    if (typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) => visit(nested, key, depth + 1));
  };
  for (const entry of entries || []) {
    const body = entry?.responsePreview || '';
    if (!body || body.startsWith('base64:')) continue;
    try {
      if (visit(JSON.parse(body))) return true;
    } catch {}
  }
  return false;
}

async function createZhipuKey({ tokenName }) {
  // Append a short timestamp suffix to avoid name collisions on the platform
  // (zhipu rejects duplicate key names silently — the confirm button works
  // but no key is actually created, resulting in 0 captured API responses).
  const uniqueName = tokenName + '-' + Date.now().toString(36).slice(-4);

  // 1. Navigate to zhipu API key page (reuse logged-in cookies)
  const nav = await sendCommand('navigate', { url: ZHIPU_URL, workspace: 'okit' }, 30000);
  if (!nav.ok) throw new Error(nav.error || 'navigate failed');
  const navData = nav.data || {};
  const tabId = navData.tabId;

  // 2. Arm network capture BEFORE clicking create
  const capStart = await sendCommand('network-capture-start',
    { pattern: '', workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!capStart.ok) throw new Error(capStart.error || 'network-capture-start failed');
  console.log('[auto-create] zhipu: capture armed');

  // 3. Wait for SPA to render the key management page, then dismiss modals.
  //    Poll for the create button to appear (up to 15s) — zhipu's SPA load
  //    time varies and a fixed sleep is unreliable.
  let createResult = '{}';
  for (let wait = 0; wait < 15; wait++) {
    await sleep(1000);
    // Dismiss leftover modals each iteration
    await execJs(`(() => {
      for (let i = 0; i < 3; i++) {
        const close = document.querySelector('.ant-modal-close, [aria-label="Close"], .ant-modal-mask');
        if (close) close.click();
        const cancel = [...document.querySelectorAll('button')].find(b => /取消|关闭|我知道了/.test(b.textContent));
        if (cancel) cancel.click();
      }
    })()`).catch(() => {});

    // Check if the create button has appeared
    createResult = await execJs(`(() => {
      const texts = ${JSON.stringify(ZHIPU_CREATE_TEXTS)};
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const visible = els.filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !e.disabled;
      });
      const btn = visible.find(e => texts.some(t => (e.textContent || '').includes(t)));
      if (!btn) return JSON.stringify({ error: 'not-found' });
      btn.click();
      return JSON.stringify({ ok: true, text: btn.textContent.slice(0, 30) });
    })()`).catch(e => JSON.stringify({ error: e.message }));
    const obj = JSON.parse(createResult || '{}');
    if (obj.ok) break;
    if (wait === 14) {
      // Last attempt — include button candidates for diagnostics
      createResult = await execJs(`(() => {
        const els = [...document.querySelectorAll('button, a, [role="button"]')];
        const visible = els.filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.disabled;
        });
        return JSON.stringify({ error: 'not-found', url: location.href, candidates: visible.slice(0, 10).map(e => e.textContent.slice(0, 25)) });
      })()`).catch(e => JSON.stringify({ error: e.message }));
    }
  }
  const createObj = JSON.parse(createResult || '{}');
  console.log('[auto-create] zhipu: create →', createResult);
  if (createObj.error) throw new Error(`创建按钮未找到。页面按钮: ${JSON.stringify(createObj.candidates || [])}`);

  // 5. Wait for dialog, fill name — scoped to modal if one exists
  await sleep(1000);
  const fillResult = await execJs(`(() => {
    // zhipu uses a custom dialog — try multiple container selectors then body
    const scopes = ['.ant-modal-content', '.ant-modal', '[role="dialog"]', '.el-dialog', '.el-dialog__body', '[class*="dialog"]', '[class*="modal"]', '[class*="popup"]', 'body'];
    for (const scope of scopes) {
      const container = scope === 'body' ? document : document.querySelector(scope);
      if (!container) continue;
      const inp = container.querySelector(${JSON.stringify(ZHIPU_NAME_SELECTORS)});
      if (inp && inp.getBoundingClientRect().width > 0) {
        // Use multiple strategies to set the value — Vue/React frameworks
        // sometimes don't react to a single input event.
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(inp, ${JSON.stringify(uniqueName)});
        // Trigger events that Vue/React/Angular listen to
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        // Also try keyboard events for frameworks that track key sequences
        inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        // Focus back to keep the field active
        inp.focus();
        return JSON.stringify({ ok: true, scope, value: inp.value });
      }
    }
    return JSON.stringify({ error: 'not-found' });
  })()`).catch(e => JSON.stringify({ error: e.message }));
  const fillObj = JSON.parse(fillResult || '{}');
  console.log('[auto-create] zhipu: fill →', fillResult);
  if (fillObj.error) throw new Error('名称输入框未找到(创建对话框可能未打开)');

  // 6. Click confirm. zhipu uses a custom dialog (not ant-modal), so we search
  //    broadly: find the name input's closest dialog ancestor, then look for a
  //    primary/confirm button within it.
  await sleep(500);
  const confirmResult = await execJs(`(() => {
    const inp = document.querySelector(${JSON.stringify(ZHIPU_NAME_SELECTORS)});
    if (!inp) return JSON.stringify({ error: 'no-input' });

    // Walk up from the input to find the dialog container
    let dialog = inp.closest('.ant-modal-content, .ant-modal, [role="dialog"], .el-dialog, .el-dialog__wrapper, .modal-content, .dialog-content, [class*="dialog"], [class*="modal"], [class*="popup"]');
    if (!dialog) {
      dialog = inp.parentElement;
      for (let i = 0; i < 5 && dialog && dialog !== document.body; i++) {
        const btns = dialog.querySelectorAll('button');
        if (btns.length >= 2) break;
        dialog = dialog.parentElement;
      }
    }

    const searchIn = dialog || document;
    // Get ALL buttons including disabled ones (to diagnose why confirm is disabled)
    const allBtns = [...searchIn.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const enabledBtns = allBtns.filter(b => !b.disabled);

    const excludePattern = /创建.*Key|新建.*Key|取消|关闭|上一步|下一步|返回/;
    // Try enabled confirm buttons first
    let confirmBtn = enabledBtns.find(b => {
      const t = b.textContent.trim();
      return /确定|确认|保存|提交|OK|Confirm|Submit/.test(t) && !excludePattern.test(t);
    });

    // If no enabled confirm button, check if there's a disabled one
    if (!confirmBtn) {
      const disabledConfirm = allBtns.find(b => {
        const t = b.textContent.trim();
        return b.disabled && /确定|确认|保存|提交/.test(t);
      });
      if (disabledConfirm) {
        // The confirm button is disabled — likely because the name value
        // wasn't accepted by the framework. Try re-filling and re-checking.
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(inp, ${JSON.stringify(uniqueName)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        // Wait a tick for the framework to re-validate
        return JSON.stringify({ error: 'confirm-disabled', inputValue: inp.value, btnStates: allBtns.map(b => ({ text: b.textContent.slice(0, 15).trim(), disabled: b.disabled })) });
      }
    }

    if (confirmBtn) {
      confirmBtn.click();
      return JSON.stringify({ ok: true, text: confirmBtn.textContent.slice(0, 20), btnCount: enabledBtns.length });
    }

    // Fallback: last enabled button
    const lastBtn = enabledBtns[enabledBtns.length - 1];
    if (lastBtn && !excludePattern.test(lastBtn.textContent)) {
      lastBtn.click();
      return JSON.stringify({ ok: true, fallback: 'last-btn', text: lastBtn.textContent.slice(0, 20) });
    }

    // Fallback: Enter key
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
    return JSON.stringify({ ok: true, fallback: 'enter', btnCount: enabledBtns.length, btnTexts: enabledBtns.map(b => b.textContent.slice(0, 15)) });
  })()`).catch(e => JSON.stringify({ error: e.message }));
  const confirmObj = JSON.parse(confirmResult || '{}');
  console.log('[auto-create] zhipu: confirm →', confirmResult);
  if (confirmObj.error === 'confirm-disabled') {
    // Confirm button is disabled — the name wasn't accepted. Retry fill + confirm.
    console.log('[auto-create] zhipu: confirm disabled, retrying fill...', confirmObj.btnStates);
    await sleep(500);
    // Use CDP Input.insertText as a more reliable alternative to value setter
    await sendCommand('cdp', {
      cdpMethod: 'Input.insertText',
      cdpParams: { text: uniqueName },
      workspace: 'okit',
    }, 5000).catch(() => {});
    await sleep(500);
    // Now try confirm again
    const confirm2 = await execJs(`(() => {
      const inp = document.querySelector(${JSON.stringify(ZHIPU_NAME_SELECTORS)});
      let dialog = inp ? inp.closest('[class*="popup"], [class*="dialog"], [class*="modal"], .ant-modal-content') : null;
      if (!dialog) dialog = document;
      const btns = [...dialog.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled;
      });
      const btn = btns.find(b => /确定|确认|保存|提交/.test(b.textContent.trim()));
      if (btn) { btn.click(); return JSON.stringify({ ok: true, retry: true, text: btn.textContent.slice(0, 15) }); }
      if (inp) {
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        return JSON.stringify({ ok: true, retry: true, fallback: 'enter' });
      }
      return JSON.stringify({ error: 'still-failed' });
    })()`).catch(e => JSON.stringify({ error: e.message }));
    console.log('[auto-create] zhipu: confirm retry →', confirm2);
  }
  if (confirmObj.error) throw new Error('确认按钮未找到(在 modal 内)');

  // 7. IMMEDIATELY after confirm, check DOM for the full key. zhipu shows the
  //    complete "apiKey.secret" in a one-time success dialog that may close
  //    quickly. We check NOW (no sleep) before the dialog disappears.
  const immediateKey = await execJs(`(() => {
    // Look everywhere for the full "hex.secret" format
    const allText = document.body.innerText || '';
    // Strategy 1: full key in visible text
    let m = allText.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/);
    if (m) return m[0];
    // Strategy 2: in input/textarea values (copy fields)
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el.value && /[a-f0-9]{32}\./.test(el.value)) return el.value.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/)[0];
    }
    // Strategy 3: in data attributes / clipboard attributes
    for (const el of document.querySelectorAll('[data-clipboard-text], [data-copy], [data-key]')) {
      const val = el.getAttribute('data-clipboard-text') || el.getAttribute('data-copy') || el.getAttribute('data-key') || '';
      m = val.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/);
      if (m) return m[0];
    }
    // Strategy 4: in any element's text content (dialogs, code blocks, spans)
    for (const el of document.querySelectorAll('[class*="key"], [class*="secret"], [class*="copy"], code, pre, .api-key')) {
      m = (el.textContent || '').match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/);
      if (m) return m[0];
    }
    return '';
  })()`).catch(() => '');
  if (immediateKey && !isAssetData(immediateKey)) {
    console.log('[auto-create] zhipu: found full key immediately after confirm');
    await closeAutomationWindow();
    return { value: immediateKey, name: uniqueName };
  }

  // 7b. Wait briefly and try again (dialog may take a moment to render)
  await sleep(1500);
  const delayedKey = await execJs(`(() => {
    const allText = document.body.innerText || '';
    let m = allText.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/);
    if (m) return m[0];
    for (const el of document.querySelectorAll('input, textarea, [data-clipboard-text], [data-key]')) {
      const val = el.value || el.getAttribute('data-clipboard-text') || el.getAttribute('data-key') || '';
      m = val.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/);
      if (m) return m[0];
    }
    return '';
  })()`).catch(() => '');
  if (delayedKey && !isAssetData(delayedKey)) {
    console.log('[auto-create] zhipu: found full key after delay');
    await closeAutomationWindow();
    return { value: delayedKey, name: uniqueName };
  }

  // 7c. (moved to after key extraction — see below)

  //    Retry reading up to 3 times — the API response may arrive later than
  //    our initial 2s wait, especially on slow connections.
  let entries = [];
  let key = null;
  for (let retry = 0; retry < 3 && !key; retry++) {
    await sleep(retry === 0 ? 3000 : 2000); // first wait 3s, then 2s increments
    const read = await sendCommand('network-capture-read',
      { workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
    if (!read.ok) break;
    // network-capture-read drains the buffer, so accumulate across retries
    const newEntries = read.data || [];
    entries = entries.concat(newEntries);

    key = extractKeyFromCaptures(entries, 'zhipu');
    if (key) break;

    // If no key yet and this is the last retry, also check if the modal is
    // still open (confirm click may not have worked)
    if (retry === 1) {
      const modalCheck = await execJs(`(() => {
        const modals = [...document.querySelectorAll('.ant-modal-content, [role="dialog"]')]
          .filter(m => m.getBoundingClientRect().width > 0);
        if (modals.length > 0) {
          // Modal still open — try clicking confirm again
          const btns = [...modals[0].querySelectorAll('button')].filter(b => {
            const r = b.getBoundingClientRect(); return r.width > 0 && !b.disabled;
          });
          const btn = btns.find(b => /确定|确认|保存/.test(b.textContent));
          if (btn) { btn.click(); return 're-clicked-confirm'; }
          return 'modal-open-no-confirm';
        }
        return 'modal-closed';
      })()`).catch(() => 'check-failed');
      console.log('[auto-create] zhipu: retry modal check →', modalCheck);
    }
  }

  console.log(`[auto-create] zhipu: captured ${entries.length} requests total`);

  // 7c. zhipu's API returns a MASKED secret. The full key (apiKey.secret) is
  //    only available via the "copy" button (class: icon-wdapp_copy common-i)
  //    next to each key in the list. We inject a fetch/clipboard interceptor,
  //    click the copy button for our key, and read the intercepted value.
  if (key) {
    // Reload the page to get a fresh key list with the newly created key
    await sendCommand('navigate', { url: ZHIPU_URL, workspace: 'okit' }, 30000).catch(() => {});
    await sleep(3000);

    // Inject a clipboard interceptor to capture what the copy button puts on the clipboard
    await execJs(`(() => {
      window.__okitCapturedKey = '';
      const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function(text) {
        window.__okitCapturedKey = text;
        return origWriteText(text);
      };
      // Also intercept execCommand('copy') as fallback
      const origExec = document.execCommand.bind(document);
      document.execCommand = function(cmd) {
        if (cmd === 'copy') {
          const sel = window.getSelection().toString();
          if (sel) window.__okitCapturedKey = sel;
        }
        return origExec(cmd);
      };
      return 'interceptor-installed';
    })()`).catch(() => 'interceptor-failed');

    // Find and click the copy button (icon-wdapp_copy) for our key
    const clickResult = await execJs(`(() => {
      const keyName = ${JSON.stringify(uniqueName)};
      const apiKey = ${JSON.stringify(key)};
      // Find the row containing our key name or apiKey
      const allEls = [...document.querySelectorAll('tr, li, [class*="row"], [class*="item"], [class*="card"], [class*="line"]')];
      let row = allEls.find(el => el.textContent.includes(keyName));
      if (!row) row = allEls.find(el => el.textContent.includes(apiKey));
      if (!row) return 'row-not-found';

      // Find the copy icon within the row
      const copyBtn = row.querySelector('.icon-wdapp_copy, [class*="wdapp_copy"], [class*="copy"]');
      if (copyBtn) { copyBtn.click(); return 'clicked-copy'; }

      // Fallback: search globally for copy icons near our key
      const allCopyBtns = [...document.querySelectorAll('.icon-wdapp_copy, [class*="wdapp_copy"]')];
      // Click each and check which one captures our key
      for (const btn of allCopyBtns) {
        btn.click();
      }
      return 'clicked-all-copy:' + allCopyBtns.length;
    })()`).catch(() => 'click-failed');
    console.log('[auto-create] zhipu: copy button →', clickResult);

    // Read the intercepted clipboard value
    await sleep(1000);
    const capturedKey = await execJs('window.__okitCapturedKey || ""').catch(() => '');
    console.log('[auto-create] zhipu: clipboard capture', capturedKey ? 'received' : 'empty');
    if (capturedKey && capturedKey.includes('.')) {
      await closeAutomationWindow();
      return { value: capturedKey, name: uniqueName };
    }
  }

  // Diagnostic: retain only request metadata. Response bodies can contain the
  // one-time secret and must not be written to logs or to temporary images.
  for (const e of entries) {
    const body = e.responsePreview || '';
    if (/api_key|api_secret|apikey|secret/i.test(body) || /api_keys/i.test(e.url || '')) {
      console.log(`[auto-create] zhipu: matched ${e.method} ${e.responseStatus} ${e.url.slice(0, 100)}`);
    }
  }
  // Count likely key-shaped values for diagnostics without emitting any value.
  const domDiag = await execJs(`(() => {
    const text = document.body.innerText || '';
    // Find all hex-dot-alphanumeric patterns
    const fullKeys = text.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/g) || [];
    // Find all 32-hex patterns
    const hexKeys = text.match(/[a-f0-9]{32}/g) || [];
    return JSON.stringify({ full: fullKeys.length, partial: hexKeys.length });
  })()`).catch(() => '{}');
  try {
    const diag = JSON.parse(domDiag || '{}');
    console.log('[auto-create] zhipu: DOM key pattern counts', { full: diag.full || 0, partial: diag.partial || 0 });
  } catch {}

  // 8. zhipu keys are "apiKey.secretKey" format. The network response only
  //    returns a masked secretKey (e.g. "*****Y4n6"), so we must get the full
  //    secret from the DOM — zhipu shows it in a success dialog or key list
  //    after creation, with a copy button containing the full value.
  if (key) {
    // We have the apiKey from network; try to find the full secret on the page
    const fullKey = await execJs(`(() => {
      const text = document.body.innerText || '';

      // Strategy 1: look for the complete "hex.alphanumeric" key format directly
      // e.g. "64a3a143172d4b5e9420583a0b93d943.i2IC1jQfoptP1xOe"
      const fullMatch = text.match(/([a-f0-9]{32}\\.[a-zA-Z0-9]{6,})/);
      if (fullMatch) return fullMatch[1];

      // Strategy 2: look in input/copy fields (zhipu may have a hidden input
      // or data-attribute with the full key for the copy-to-clipboard feature)
      const inputs = [...document.querySelectorAll('input, textarea, [data-key], [data-clipboard-text]')];
      for (const el of inputs) {
        const val = el.value || el.getAttribute('data-key') || el.getAttribute('data-clipboard-text') || '';
        const m = val.match(/([a-f0-9]{32}\\.[a-zA-Z0-9]{6,})/);
        if (m) return m[1];
      }

      // Strategy 3: look in clipboard-related buttons or code blocks
      const codeBlocks = [...document.querySelectorAll('code, pre, .api-key-value, .key-value, [class*="key"], [class*="secret"]')];
      for (const el of codeBlocks) {
        const val = el.textContent || el.value || '';
        const m = val.match(/([a-f0-9]{32}\\.[a-zA-Z0-9]{6,})/);
        if (m) return m[1];
      }

      return '';
    })()`).catch(() => '');
    if (fullKey && !isAssetData(fullKey)) {
      console.log('[auto-create] zhipu: found full key (with secret) from DOM');
      key = fullKey;
    }
  }

  // 9. If still no key, try DOM-only extraction (full key format or partial)
  if (!key) {
    const domKey = await execJs(`(() => {
      const text = document.body.innerText || '';
      const fullMatch = text.match(/([a-f0-9]{32}\\.[a-zA-Z0-9]{6,})/);
      if (fullMatch) return fullMatch[1];
      const m = text.match(/\\b([a-f0-9]{32})\\b/) || text.match(/(eyJ[a-zA-Z0-9\\-_]{50,})/);
      return m ? m[1] : '';
    })()`).catch(() => '');
    if (domKey && !isAssetData(domKey)) key = domKey;
  }

  if (!key) {
    // List key-like API URLs in the error for debugging
    const apiUrls = entries
      .filter(e => /api_keys|apikeys|apikey|token/i.test(e.url))
      .map(e => `${e.method} ${e.responseStatus} ${e.url.slice(0, 120)}`)
      .join('\n  ');
    throw new Error(`未捕获到 key (抓包 ${entries.length} 条,API 相关:\n  ${apiUrls || '(无)'})`);
  }

  await closeAutomationWindow();
  return { value: key, name: uniqueName };
}

// ─── Volcengine Ark (火山方舟) — atomic-capability orchestration ──
// The IAM API-key page creates AK/SK credentials for the cloud API. Those
// credentials cannot authenticate against Ark's OpenAI-compatible /api/v3
// endpoint. Model management must instead use Ark's dedicated API Key page.
// Live-verified flow: API Key 管理 → 创建 API Key → 名称 → 创建 → find the
// created row → click its eye icon. Ark's creation response contains only an
// internal API-key ID; the actual model credential is revealed by that row.
const VOLC_URL = 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey';
const VOLC_CREATE_TEXTS = ['创建 API Key'];

async function createVolcengineKey({ tokenName }) {
  // Platform names must be unique. Keep the vault variable deterministic while
  // using a harmless suffix only for the console-side display name.
  const uniqueName = `${tokenName}-${Date.now().toString(36).slice(-4)}`;
  const nav = await sendCommand('navigate', { url: VOLC_URL, workspace: 'okit' }, 30000);
  if (!nav.ok) throw new Error(nav.error || 'navigate failed');
  const tabId = nav.data && nav.data.tabId;
  console.log('[auto-create] volcengine: navigated (tab ' + tabId + ')');

  const capStart = await sendCommand('network-capture-start',
    { pattern: '', workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!capStart.ok) throw new Error(capStart.error || 'network-capture-start failed');
  console.log('[auto-create] volcengine: capture armed');

  // Ark is an SPA. Poll its explicit create action rather than assuming a
  // fixed load time, so an expired session is not misreported as a click bug.
  let opened = false;
  for (let attempt = 0; attempt < 12 && !opened; attempt += 1) {
    const result = await execJs(`(() => {
      const visible = el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
      };
      const button = [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .find(el => ${JSON.stringify(VOLC_CREATE_TEXTS)}.includes((el.textContent || '').trim().replace(/\s+/g, ' ')));
      if (!button) return JSON.stringify({ error: 'create-not-found' });
      button.click();
      return JSON.stringify({ ok: true });
    })()`).catch(() => '{}');
    try { opened = Boolean(JSON.parse(result || '{}').ok); } catch {}
    if (!opened) await sleep(1000);
  }
  if (!opened) throw new Error('未找到火山方舟“创建 API Key”按钮');

  await sleep(500);
  const formResult = await execJs(`(() => {
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    // The Ark modal contains several nested elements whose generated class
    // names include "dialog". Selecting the last such element can scope us
    // below the input. Locate the visible form control globally, but require
    // the provider's visible label/default name so the global page search box
    // is never chosen.
    const inputs = [...document.querySelectorAll('input')]
      .filter(el => visible(el) && !el.disabled);
    const input = inputs.find(el => /名称|name/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')))
      || inputs.find(el => /^api-key-/i.test(el.value || ''));
    if (!input) return JSON.stringify({ error: 'name-input-not-found' });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(uniqueName)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const create = [...document.querySelectorAll('button, [role="button"]')].find(el => {
      const text = (el.textContent || '').trim().replace(/\s+/g, '');
      return visible(el) && text === '创建' && !el.disabled;
    });
    if (!create) return JSON.stringify({ error: 'confirm-not-found' });
    create.click();
    return JSON.stringify({ ok: true });
  })()`).catch(() => '{}');
  let formState = {};
  try { formState = JSON.parse(formResult || '{}'); } catch {}
  if (formState.error) throw new Error(`火山方舟创建对话框异常：${formState.error}`);

  await sleep(800);
  // The create mutation returns an internal 32-character API-key ID, not the
  // model API credential. Ark exposes the actual key only after the eye icon
  // in its newly-created table row is clicked. Scope every action to our
  // unique display name so we never reveal or copy a different key.
  let key = '';
  for (let attempt = 0; attempt < 8 && !key; attempt += 1) {
    const revealResult = await execJs(`(() => {
      const rows = [...document.querySelectorAll('tr')];
      const row = rows.find(el => (el.innerText || '').includes(${JSON.stringify(uniqueName)}));
      if (!row) return JSON.stringify({ error: 'created-row-not-found' });
      const eye = row.querySelector('svg[class*="eye"]');
      if (!eye) return JSON.stringify({ error: 'reveal-control-not-found' });
      const clickable = eye.parentElement || eye;
      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      clickable.click?.();
      return JSON.stringify({ ok: true });
    })()`).catch(() => '{}');
    let revealState = {};
    try { revealState = JSON.parse(revealResult || '{}'); } catch {}
    if (revealState.error && revealState.error !== 'created-row-not-found') {
      throw new Error(`火山方舟创建成功，但无法展开该 Key：${revealState.error}`);
    }
    await sleep(350);
    const revealed = await execJs(`(() => {
      const row = [...document.querySelectorAll('tr')]
        .find(el => (el.innerText || '').includes(${JSON.stringify(uniqueName)}));
      if (!row) return '';
      // Ark keys are opaque 46-character tokens. Resource IDs are shorter
      // apikey-prefixed resource IDs are intentionally excluded here.
      const match = (row.innerText || '').match(/\\b[A-Za-z0-9_-]{40,}\\b/);
      return match ? match[0] : '';
    })()`).catch(() => '');
    if (revealed && !isAssetData(revealed)) key = revealed;
    if (!key) await sleep(500);
  }
  if (key) {
    await closeAutomationWindow();
    return { value: key, name: tokenName };
  }

  await sleep(700);
  const read = await sendCommand('network-capture-read',
    { workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!read.ok) throw new Error(read.error || 'network-capture-read failed');
  const entries = read.data || [];
  console.log('[auto-create] volcengine: captured ' + entries.length + ' requests');
  // Response bodies can contain a one-time credential. Keep diagnostics to
  // field paths, lengths and shapes so an Ark UI/API change is observable
  // without writing any key material to logs.
  const volcSecretFields = describeCapturedSecretFields(entries);
  if (volcSecretFields.length) {
    console.log('[auto-create] volcengine: safe key-field diagnostics ' + JSON.stringify(volcSecretFields));
  }

  const capturedCandidate = extractKeyFromCaptures(entries, 'volcengine');
  // Do not mistake Ark's 32-character internal ID for a usable credential.
  key = /^[A-Za-z0-9_-]{40,}$/.test(capturedCandidate || '') ? capturedCandidate : '';

  if (!key) {
    const domKey = await execJs(`(() => {
      const text = document.body.innerText || '';
      // Ark keys are UUID-like; never fall back to the IAM AKLT pattern.
      const arkMatch = text.match(/\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/i);
      if (arkMatch) return arkMatch[0];
      const tokens = text.match(/[a-zA-Z0-9_-]{40,}/g) || [];
      for (const t of tokens) {
        if (t.length > 500 || /css|chunk|font|webpack|preview/i.test(t)) continue;
        if (/^[0-9]+$/.test(t)) continue;
        return t;
      }
      return '';
    })()`).catch(() => '');
    if (domKey && !isAssetData(domKey)) key = domKey;
  }

  if (!key) {
    const apiUrls = entries
      .filter(e => /ark|key|token|secret/i.test(e.url))
      .map(e => e.method + ' ' + e.responseStatus + ' ' + e.url.slice(0, 100))
      .join('\n  ');
    throw new Error('volcengine 未捕获到 key (抓包 ' + entries.length + ' 条。API 相关:\n  ' + (apiUrls || '(无)') + ')');
  }

  await closeAutomationWindow();
  return { value: key, name: tokenName };
}

// ─── MiniMax — atomic-capability orchestration ──────────────────────
// Flow: navigate → arm capture → dismiss M3 promo modal → click "创建" →
//       fill name in ant-modal → confirm via ant-modal-Footer primary btn →
//       read → extract. Known gotcha: a "MiniMax M3" promotional modal
//       covers the create button and must be dismissed first.
const MINIMAX_URL = 'https://platform.minimaxi.com/user-center/basic-information/interface-key';
const MINIMAX_CREATE_TEXTS = ['创建 API Key', '创建新的', 'Create new', '新建', '创建', 'Create'];

async function createMinimaxKey({ tokenName }) {
  // Append timestamp suffix to avoid name collisions on the platform
  const uniqueName = tokenName + '-' + Date.now().toString(36).slice(-4);

  const nav = await sendCommand('navigate', { url: MINIMAX_URL, workspace: 'okit' }, 30000);
  if (!nav.ok) throw new Error(nav.error || 'navigate failed');
  const tabId = nav.data && nav.data.tabId;

  const capStart = await sendCommand('network-capture-start',
    { pattern: '', workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!capStart.ok) throw new Error(capStart.error || 'network-capture-start failed');
  console.log('[auto-create] minimax: capture armed');

  await sleep(3000);

  // CRITICAL: dismiss the "MiniMax M3" promotional modal first — it covers
  // the create button and intercepts clicks.
  await execJs(`(() => {
    for (let i = 0; i < 8; i++) {
      // Close buttons: 我知道了 / 关闭 / 取消 + generic modal close
      const closeTexts = ['我知道了', '关闭', '取消', 'Close', 'Got it'];
      const btns = [...document.querySelectorAll('button, [role="button"]')];
      const close = btns.find(b => closeTexts.some(t => (b.textContent || '').trim() === t || (b.textContent || '').includes(t)));
      if (close) { close.click(); }
      const x = document.querySelector('.ant-modal-close, [aria-label="Close"]');
      if (x) { x.click(); }
      const mask = document.querySelector('.ant-modal-mask');
      if (mask) { mask.click(); }
    }
    return 'promo-dismissed';
  })()`).catch(() => 'promo-skipped');
  console.log('[auto-create] minimax: promo dismissed');
  await sleep(500);

  // Click create button
  await execJs(`(() => {
    const texts = ${JSON.stringify(MINIMAX_CREATE_TEXTS)};
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const visible = els.filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.disabled;
    });
    const btn = visible.find(e => texts.some(t => (e.textContent || '').includes(t)));
    if (!btn) throw new Error('未找到创建按钮');
    btn.click();
    return 'clicked';
  })()`);
  console.log('[auto-create] minimax: create clicked');

  // Wait for the ant-modal to appear
  await sleep(2500);

  // Fill name — minimax uses ant-modal inputs
  await execJs(`(() => {
    // Try multiple selectors within the modal
    const selectors = ['.ant-modal input', '.ant-modal-content input', 'input.ant-input', 'input[type="text"]:not([disabled])'];
    for (const sel of selectors) {
      const inp = document.querySelector(sel);
      if (inp && inp.getBoundingClientRect().width > 0) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, ${JSON.stringify(uniqueName)});
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 'filled:' + sel;
      }
    }
    throw new Error('未找到 modal 输入框');
  })()`);

  // Confirm via ant-modal-Footer primary button
  await sleep(500);
  await execJs(`(() => {
    const selectors = [
      '.ant-modal-footer button.ant-btn-primary',
      '.ant-modal-Footer button.ant-btn-primary',
      '.ant-modal-footer button:not([disabled])',
      '.ant-modal button[type="submit"]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.getBoundingClientRect().width > 0 && !btn.disabled) {
        btn.click();
        return 'confirmed:' + sel;
      }
    }
    // Fallback: any primary-looking button in modal
    const modal = document.querySelector('.ant-modal-content');
    if (modal) {
      const btns = [...modal.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0 && !b.disabled);
      const primary = btns.find(b => /确定|确认|创建|Create|Confirm/i.test(b.textContent));
      if (primary) { primary.click(); return 'fallback-confirmed'; }
    }
    throw new Error('未找到确认按钮');
  })()`);

  await sleep(3000);
  const read = await sendCommand('network-capture-read',
    { workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!read.ok) throw new Error(read.error || 'network-capture-read failed');
  const entries = read.data || [];
  console.log(`[auto-create] minimax: captured ${entries.length} requests`);

  let key = extractKeyFromCaptures(entries, 'minimax');

  // DOM fallback — minimax key format is sk-api-...
  if (!key) {
    const domKey = await execJs(`(() => {
      const text = document.body.innerText || '';
      const m = text.match(/(sk-api-[a-zA-Z0-9\-_]{20,})/) || text.match(/(sk-[a-zA-Z0-9\-_]{30,})/);
      return m ? m[1] : '';
    })()`).catch(() => '');
    if (domKey && !isAssetData(domKey)) key = domKey;
  }

  if (!key) {
    const apiUrls = entries
      .filter(e => /key|token|interface|api/i.test(e.url))
      .map(e => `${e.method} ${e.responseStatus} ${e.url.slice(0, 120)}`)
      .join('\n  ');
    throw new Error(`minimax 未捕获到 key (抓包 ${entries.length} 条,API 相关:\n  ${apiUrls || '(无)'})`);
  }

  await closeAutomationWindow();
  return { value: key, name: uniqueName };
}

// ─── Platform registry and shared browser flow ─────────────────────
//
// The registry is the single source of truth for the Vault UI and the API.
// Every entry below maps to an online provider available in Model Management;
// local runtimes and OAuth-only Codex intentionally do not appear here.
// A browser flow always uses the user's already signed-in session in the OKIT
// automation window. It never receives or stores a platform password.

const AUTO_CREATE_PLATFORMS = [
  { id: 'cloudflare', label: 'Cloudflare', keyHint: 'CLOUDFLARE_TOKEN', groupHint: 'Cloudflare', mode: 'api' },
  // Verified in the authenticated Platform console: the name field is
  // "My Test Key", and the dialog ends with "Create secret key".
  { id: 'openai', label: 'OpenAI', keyHint: 'OPENAI_API_KEY', groupHint: 'OpenAI', mode: 'browser', url: 'https://platform.openai.com/api-keys', createTexts: ['Create new secret key'], nameSelectors: ['input[placeholder="My Test Key"]'], confirmTexts: ['Create secret key'], postCreateDomReadAttempts: 5, postCreateReadAttempts: 5, keyPatterns: ['sk-(?:proj-)?[A-Za-z0-9_-]{20,}'] },
  { id: 'anthropic', label: 'Anthropic', keyHint: 'ANTHROPIC_API_KEY', groupHint: 'Anthropic', mode: 'browser', url: 'https://console.anthropic.com/settings/keys', createTexts: ['Create Key', 'Create API Key', 'Create key'], confirmTexts: ['Create Key', 'Copy'], postCreateDomReadAttempts: 8, postCreateReadAttempts: 8, postCreateKeySelectors: ['[role="dialog"] input[readonly]', '[role="dialog"] input[type="text"]', 'input[value*="sk-ant"]', 'span[class*="key"]', 'code'], keyPatterns: ['sk-ant-api[a-zA-Z0-9_-]{16,}'] },
  // Verified in the signed-in Chinese AI Studio UI: the key is named through
  // its aria-labelled input and finalized with "创建密钥".
  { id: 'google', label: 'Google Gemini', keyHint: 'GEMINI_API_KEY', groupHint: 'Google', mode: 'browser', url: 'https://aistudio.google.com/app/apikey', createTexts: ['创建 API 密钥', 'Create API key', 'Create API Key'], nameSelectors: ['input[aria-label="为密钥命名"]'], formBlockers: [{ text: 'No Cloud Projects Available', message: 'Gemini 需要先在 Google AI Studio 导入或创建一个 Google Cloud 项目，才能创建 API 密钥。' }], confirmTexts: ['创建密钥', 'Create key'], postCreateDomReadAttempts: 5, postCreateReadAttempts: 5, keyPatterns: ['AIza[0-9A-Za-z_-]{20,}'] },
  { id: 'volcengine', label: '火山引擎', keyHint: 'VOLCENGINE_API_KEY', groupHint: '火山引擎', mode: 'browser' },
  { id: 'zhipu', label: '智谱 AI（国内站）', keyHint: 'ZHIPUAI_API_KEY', groupHint: '智谱AI', mode: 'browser' },
  // Verified on the signed-in Z.AI console: the entry is "Add API Key", then
  // the dialog requires an "API key name" before its "Create" action is enabled.
  { id: 'zai-global', label: 'Z.AI（国际站）', keyHint: 'ZAI_API_KEY', groupHint: 'Z.AI', mode: 'browser', url: 'https://z.ai/manage-apikey/apikey-list', createTexts: ['Add API Key'], nameSelectors: ['input#apiKeyName', 'input[placeholder="API key name"]'], confirmTexts: ['Create'], postCreateReadAttempts: 5, postCreateRowCopySelector: 'svg.lucide-copy', postCreateCopyAttempts: 20, postCreateCopyRetryMs: 1000, allowExtensionClipboardRead: true, requirePostCreateCopy: true, keyPatterns: ['[^.\\s]{8,128}\\.[^.\\s]{8,256}'], postCreateCopyFailureMessage: 'Z.AI 已创建 API Key，但列表复制控件没有返回可保存的明文；为避免保存掩码，已停止写入 Vault。' },
  { id: 'minimax', label: 'MiniMax（国内站）', keyHint: 'MINIMAX_API_KEY', groupHint: 'MiniMax', mode: 'browser' },
  // Verified on the signed-in international console: "Create new API Key"
  // opens a named form whose final action is simply "Create".
  { id: 'minimax-global', label: 'MiniMax（国际站）', keyHint: 'MINIMAX_GLOBAL_API_KEY', groupHint: 'MiniMax', mode: 'browser', url: 'https://platform.minimax.io/user-center/basic-information/interface-key', createTexts: ['Create new API Key'], nameSelectors: ['input#token_name', 'input[placeholder="Please enter a key name"]'], confirmTexts: ['Create'], postCreateReadAttempts: 5, keyPatterns: ['sk-(?:api-)?[A-Za-z0-9_-]{20,}'] },
  { id: 'deepseek', label: 'DeepSeek', keyHint: 'DEEPSEEK_API_KEY', groupHint: 'DeepSeek', mode: 'browser', url: 'https://platform.deepseek.com/api_keys', preCreateDismissTexts: ['稍后再填'], createTexts: ['Create new API key', 'Create API key', '创建 API Key', '创建新密钥'], keyPatterns: ['sk-[A-Za-z0-9_-]{20,}'], readyAfterMs: 15000 },
  // Verified against the signed-in Kimi international console. The form
  // requires both a name and a project; only its visible `default` project is
  // eligible for automatic selection.
  { id: 'moonshot', label: 'Moonshot（Kimi 国际站）', keyHint: 'MOONSHOT_API_KEY', groupHint: 'Kimi 国际站', mode: 'browser', url: 'https://platform.kimi.ai/console/api-keys', createTexts: ['Create API Key'], createWaitAttempts: 10, nameSelectors: ['input[placeholder*="Maximum 32"]'], defaultProjectLabel: 'default', confirmTexts: ['OK'], keyPatterns: ['sk-[A-Za-z0-9_-]{20,}'] },
  // Keep the stable ID for existing configurations. The Kimi product uses the
  // mainland API console, not the separate Kimi Code subscription page.
  { id: 'kimi-coding', label: 'Kimi', keyHint: 'KIMI_API_KEY', groupHint: 'Kimi', mode: 'browser', url: 'https://platform.kimi.com/console/api-keys', createTexts: ['新建 API Key'], createWaitAttempts: 10, nameSelectors: ['input[placeholder*="最多输入32"]'], defaultProjectLabel: 'default', confirmTexts: ['确定'], keyPatterns: ['sk-[A-Za-z0-9_-]{20,}'] },
  // Verified in the signed-in Bailian console: the default workspace is
  // already selected; fill its optional description textarea before "确定".
  { id: 'qwen', label: '通义千问（百炼）', keyHint: 'DASHSCOPE_API_KEY', groupHint: '阿里云百炼', mode: 'browser', url: 'https://bailian.console.aliyun.com/?tab=model#/api-key', createTexts: ['创建API Key'], createWaitAttempts: 10, nameSelectors: ['textarea#description'], confirmTexts: ['确定'], postCreateDomReadAttempts: 5, postCreateReadAttempts: 5, keyPatterns: ['sk-[A-Za-z0-9._-]{20,}'] },
  // Verified on the signed-in BCE API Key page: clicking the list toolbar
  // starts an async route transition before the name form is mounted. Wait
  // for that real form instead of treating the still-visible AI-assistant
  // recommendations as a failed confirmation state.
  { id: 'qianfan', label: '百度千帆', keyHint: 'QIANFAN_API_KEY', groupHint: '百度千帆', mode: 'browser', url: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', createTexts: ['创建API Key'], formReadyAttempts: 12, formReadyDelayMs: 500, nameSelectors: ['input#name', 'input[placeholder*="1-64"]'], confirmTexts: ['确定'], postCreateReadAttempts: 5, keyPatterns: ['bce-v3/[A-Za-z0-9_./=-]{20,}'] },
  // Token Plan is the current Coding Plan product. Its dedicated key is
  // generated directly by the subscribed account and revealed only through
  // the page's verified Copy action.
  { id: 'qianfan-coding', label: '百度千帆 Coding Plan', keyHint: 'QIANFAN_CODING_PLAN_API_KEY', groupHint: '百度千帆 Coding Plan', mode: 'browser', url: 'https://console.bce.baidu.com/qianfan/resource/token-plan', createTexts: ['点击生成', '复制'], creationActionOnly: true, postCreateCopyTexts: ['复制'], postCreateCopyAttempts: 8, postCreateCopyRetryMs: 700, postCreateCopyNeedsForeground: true, allowExtensionClipboardRead: true, keyPatterns: ['bce-v3/[A-Za-z0-9_./=-]{20,}'], postCreateCopyFailureMessage: '百度千帆 Coding Plan 已尝试生成并复制专属 Key，但没有读取到可保存的明文；为避免保存掩码，请在 Token Plan 页面手动点击复制后重试。' },
  // MiMo serves the public product page and Console from one origin. Going to
  // the homepage first leaves automation at marketing navigation; the real
  // signed-in API key screen is this exact Console route.
  // Verified on the signed-in MiMo Console: "Create API Key" opens a dialog
  // that requires its name input before the English "Confirm" button can run.
  { id: 'xiaomi', label: '小米 MiMo', keyHint: 'XIAOMI_MIMO_API_KEY', groupHint: '小米 MiMo', mode: 'browser', url: 'https://platform.xiaomimimo.com/console/api-keys', createTexts: ['Create API Key'], nameSelectors: ['input#apiKeyName', 'input[placeholder="Please enter"]'], confirmTexts: ['Confirm'], postCreateReadAttempts: 5, keyPatterns: ['sk-[A-Za-z0-9_-]{20,}'] },
  // Token Plan keys are managed on MiMo's separate subscription page. The
  // page creates the dedicated key without a name field, then reveals it only
  // in a one-time dialog whose verified "复制/Copy" action must be used.
  { id: 'xiaomi-coding', label: '小米 MiMo Token Plan', keyHint: 'XIAOMI_MIMO_TOKEN_PLAN_API_KEY', groupHint: '小米 MiMo Token Plan', mode: 'browser', url: 'https://platform.xiaomimimo.com/console/plan-manage', createTexts: ['创建 API Key', 'Create API Key'], creationActionOnly: true, reuseExistingMaskedKey: true, existingMaskedKeyPrefix: 'tp-', existingMaskedCopyFailureMessage: '小米 MiMo Token Plan 已存在 API Key，但复制控件没有返回可保存的明文；为避免重复创建，请在订阅管理页面手动点击复制后重试。', postCreateCopyTexts: ['复制', 'Copy'], postCreateCopyByMaskedKeyPrefix: 'tp-', postCreateCopyAttempts: 8, postCreateCopyRetryMs: 700, postCreateCopyNeedsForeground: true, allowExtensionClipboardRead: true, postCreateReadAttempts: 5, keyPatterns: ['tp-[A-Za-z0-9_-]{5,}'], postCreateCopyFailureMessage: '小米 MiMo Token Plan 已创建，但复制控件没有返回可保存的明文；为避免保存掩码，请在订阅管理页面手动点击复制后重试。' },
  // Verified on the signed-in interface-key page: creation requires a name in
  // the "最多输入20个字" field before the "确认" action becomes enabled.
  { id: 'stepfun', label: '阶跃星辰（StepFun）', keyHint: 'STEPFUN_API_KEY', groupHint: 'StepFun', mode: 'browser', url: 'https://platform.stepfun.com/interface-key', createTexts: ['创建新的密钥'], nameSelectors: ['input[placeholder*="最多输入20"]'], confirmTexts: ['确认'], postCreateReadAttempts: 5, keyPatterns: ['[A-Za-z0-9_-]{32,}'] },
  // The signed-in xAI console redirects / to a team-scoped Dashboard route.
  // Follow the real sidebar link so the opaque team ID is never hard-coded.
  // Its create dialog uses the same "Create API key" label for its final
  // submit button, so this platform explicitly permits that confirmed reuse.
  { id: 'xai', label: 'xAI（Grok）', keyHint: 'XAI_API_KEY', groupHint: 'xAI', mode: 'browser', url: 'https://console.x.ai/', preNavigationTexts: ['API Keys'], createTexts: ['Create API key'], nameSelectors: ['input[placeholder="Production key"]'], confirmTexts: ['Create API key'], allowConfirmCreateText: true, postCreateReadAttempts: 5, keyPatterns: ['xai-[A-Za-z0-9_-]{20,}'] },
  // Verified on the signed-in Mistral workspace page. Its top-level and final
  // form actions are both labelled "New key"; the latter appears only in the
  // opened profile dialog and is therefore an intentional confirmed reuse.
  { id: 'mistral', label: 'Mistral', keyHint: 'MISTRAL_API_KEY', groupHint: 'Mistral', mode: 'browser', url: 'https://console.mistral.ai/api-keys', createTexts: ['New key'], formEntryTexts: ['Create new key'], nameSelectors: ['input[placeholder="My API Key"]'], confirmTexts: ['New key'], allowConfirmCreateText: true, postCreateKeySelectors: ['[role="dialog"] input'], postCreateDomReadAttempts: 12, postCreateReadAttempts: 5, keyPatterns: ['\\b[A-Za-z0-9]{32}\\b'] },
  // /keys is OpenRouter's documented entry point. It redirects signed-in users
  // to their default workspace and signed-out users to the sign-in page.
  // Verified in the workspace keys screen: "New Key" opens a form whose
  // required name is #name and final submit action is "Create".
  { id: 'openrouter', label: 'OpenRouter', keyHint: 'OPENROUTER_API_KEY', groupHint: 'OpenRouter', mode: 'browser', url: 'https://openrouter.ai/keys', createTexts: ['New Key'], nameSelectors: ['input#name', 'input[placeholder*="Chatbot Key"]'], confirmTexts: ['Create'], postCreateReadAttempts: 5, keyPatterns: ['sk-or-v1-[A-Za-z0-9_-]{20,}'] },
];

const AUTO_CREATE_PLATFORM_MAP = new Map(AUTO_CREATE_PLATFORMS.map(platform => [platform.id, platform]));

const SPECIAL_PLATFORM_URLS = {
  zhipu: ZHIPU_URL,
  volcengine: VOLC_URL,
  minimax: MINIMAX_URL,
};

function getBrowserPlatformUrl(platform) {
  return platform.url || SPECIAL_PLATFORM_URLS[platform.id];
}

// OpenRouter has been verified end-to-end. Cloudflare creates tokens directly
// from a user-supplied parent token, so neither belongs in the browser-login
// verification batch.
const BROWSER_LOGIN_VERIFICATION_PLATFORMS = AUTO_CREATE_PLATFORMS
  .filter(platform => platform.mode === 'browser' && platform.id !== 'openrouter')
  .map(platform => ({ id: platform.id, label: platform.label, url: getBrowserPlatformUrl(platform) }))
  .filter(platform => platform.url);

function keyFromText(text, platform) {
  const patterns = platform.keyPatterns || [];
  for (const source of patterns) {
    const match = String(text || '').match(new RegExp(source));
    if (match && !isAssetData(match[0])) return match[0];
  }
  return null;
}

async function clickCreateAction(platform) {
  const raw = await execJs(`(() => {
    const texts = ${JSON.stringify(platform.createTexts || [])};
    const pageText = (document.body?.innerText || '').slice(0, 16000);
    const workspaceKeys = /\\/workspaces\\/[^/]+\\/keys(?:[/?#]|$)/.test(location.pathname);
    const keyInterface = /API Keys|Create (?:API )?Key|Key Management/i.test(pageText);
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled;
    });
    const target = candidates.find(el => texts.some(text => (el.textContent || '').trim().toLowerCase().includes(text.toLowerCase())));
    if (!target) return JSON.stringify({
      error: 'create-not-found',
      buttons: candidates.slice(0, 12).map(el => (el.textContent || '').trim().slice(0, 40)),
      workspaceKeys,
      keyInterface,
    });
    target.click();
    return JSON.stringify({ ok: true, text: (target.textContent || '').trim().slice(0, 60) });
  })()`);
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function createGenericBrowserKey({ tokenName, platform }) {
  if (!platform.url) throw new Error('该平台还没有可自动创建密钥的控制台地址');

  const uniqueName = `${tokenName}-${Date.now().toString(36).slice(-4)}`;
  const nav = await sendCommand('navigate', { url: platform.url, workspace: 'okit' }, 30000);
  if (!nav.ok) throw new Error(nav.error || '打开密钥管理页失败');
  const tabId = nav.data && nav.data.tabId;
  const arrivedUrl = nav.data && nav.data.url;
  if (isLoginUrl(arrivedUrl)) {
    throw new Error(`Login required at ${arrivedUrl}`);
  }

  const capStart = await sendCommand('network-capture-start',
    { pattern: '', workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!capStart.ok) throw new Error(capStart.error || '无法开始安全抓取');

  await sleep(3000);
  // A few providers expose their console from a public product page. Follow
  // only the explicitly configured, non-destructive console action first.
  if (platform.preNavigationTexts?.length) {
    await execJs(`(() => {
      const texts = ${JSON.stringify(platform.preNavigationTexts)};
      const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled;
      });
      const target = candidates.find(el => texts.some(text => (el.textContent || '').trim().toLowerCase() === text.toLowerCase()));
      if (target) { target.click(); return 'clicked'; }
      return 'not-found';
    })()`).catch(() => 'not-found');
    await sleep(2500);
  }
  // Some providers display a non-blocking profile reminder over their API-key
  // list. Dismiss only the provider's verified opt-out action; this never
  // accepts terms, billing, or permission changes on the user's behalf.
  if (platform.preCreateDismissTexts?.length) {
    await execJs(`(() => {
      const texts = ${JSON.stringify(platform.preCreateDismissTexts)};
      const visible = el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
      };
      const target = [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .find(el => texts.includes((el.textContent || '').trim()));
      if (target) target.click();
      return target ? 'dismissed' : 'not-found';
    })()`).catch(() => 'not-found');
    await sleep(350);
  }
  if (platform.id === 'openrouter') {
    await handoffOpenRouterLoginIfNeeded();
  }
  // Dismiss only generic promotional/cookie overlays before looking for the
  // create action. The actual creation dialog is never dismissed here.
  await execJs(`(() => {
    const closers = [...document.querySelectorAll('button, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && /^(关闭|取消|我知道了|Close|Dismiss|Got it)$/i.test((el.textContent || '').trim());
    });
    closers.slice(0, 2).forEach(el => el.click());
  })()`).catch(() => {});

  // MiMo Token Plan shows only Copy and Reset once a key already exists. In
  // that state there is deliberately no Create API Key button. Reuse the
  // existing key by clicking only the first icon in the masked-key row; never
  // click Reset and never create a duplicate credential.
  if (platform.reuseExistingMaskedKey) {
    const existingRaw = await execJs(`(() => {
      const prefix = ${JSON.stringify(platform.existingMaskedKeyPrefix || '')};
      const visible = el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled;
      };
      const keyNode = [...document.querySelectorAll('p, span, div')]
        .filter(visible)
        .map(el => ({ el, text: (el.textContent || '').trim() }))
        .filter(item => item.text.startsWith(prefix) && item.text.indexOf('***') >= prefix.length + 5)
        .sort((a, b) => a.text.length - b.text.length)[0]?.el;
      let row = keyNode;
      for (let depth = 0; row && depth < 5; depth += 1, row = row.parentElement) {
        const buttons = [...row.querySelectorAll('button, a, [role="button"]')].filter(visible);
        if (!buttons.length) continue;
        const rect = buttons[0].getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, buttonCount: buttons.length });
      }
      return JSON.stringify({ found: false });
    })()`).catch(() => '{"found":false}');
    let existingState = {};
    try { existingState = JSON.parse(existingRaw || '{}'); } catch {}
    if (existingState.found) {
      const clicked = await foregroundClick({ x: existingState.x, y: existingState.y, tabId });
      if (!clicked) throw new Error(platform.existingMaskedCopyFailureMessage || '已有 API Key 的复制控件无法点击');
      await sleep(500);
      if (platform.allowExtensionClipboardRead) {
        const clipboardRead = await sendCommand('clipboard-read', {
          workspace: 'okit',
          clipboardPattern: platform.keyPatterns?.[0] || '',
        }, 5000).catch(() => ({ ok: false, data: {} }));
        const clipboardValue = clipboardRead.ok && clipboardRead.data?.matched ? clipboardRead.data.value : '';
        const clipboardKey = keyFromText(clipboardValue, platform);
        if (clipboardKey) {
          await closeAutomationWindow();
          return { value: clipboardKey, name: tokenName };
        }
      }
      const existingNetwork = await sendCommand('network-capture-read', {
        workspace: 'okit',
        ...(tabId ? { tabId } : {}),
      }, 10000).catch(() => ({ ok: false, data: [] }));
      const existingEntries = existingNetwork.ok ? (existingNetwork.data || []) : [];
      const existingKey = keyFromText(extractKeyFromCaptures(existingEntries, platform.id), platform);
      if (existingKey) {
        await closeAutomationWindow();
        return { value: existingKey, name: tokenName };
      }
      throw new Error(platform.existingMaskedCopyFailureMessage || '已有 API Key，但复制控件没有返回可保存的明文');
    }
  }

  let createState = await clickCreateAction(platform);
  // The Kimi console first renders its organization/navigation shell and only
  // adds the API key action after asynchronous data finishes loading. Poll the
  // proven action rather than guessing from the shell's early buttons.
  const createAttempts = Math.max(1, Number(platform.createWaitAttempts) || 1);
  for (let attempt = 1; createState.error === 'create-not-found' && attempt < createAttempts; attempt += 1) {
    await sleep(1000);
    createState = await clickCreateAction(platform);
  }
  // The public OpenRouter shell can arrive after the earlier page-state probe.
  // These labels are the final button search's reliable, live signal.
  if (platform.id === 'openrouter'
    && createState.error
    && hasOpenRouterPublicNavigation(createState.buttons || [])
    && !createState.workspaceKeys
    && !createState.keyInterface) {
    await redirectOpenRouterToLogin();
    throw new Error('OpenRouter login required');
  }
  if (createState.error) throw new Error(`未找到创建密钥按钮：${(createState.buttons || []).join('、') || '请确认已登录并拥有创建权限'}`);

  // Mistral's workspace action first opens the user's key-management panel;
  // enter its real form through the panel's visible "Create new key" action.
  if (platform.formEntryTexts?.length) {
    let formEntryState = { error: 'form-entry-not-found', buttons: [] };
    const formEntryAttempts = Math.max(1, Number(platform.formEntryWaitAttempts) || 5);
    for (let attempt = 0; attempt < formEntryAttempts; attempt += 1) {
      await sleep(attempt === 0 ? 500 : 500);
      const raw = await execJs(`(() => {
        const texts = ${JSON.stringify(platform.formEntryTexts)};
        const visible = el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled;
        };
        const candidates = [...document.querySelectorAll('button, a, [role="button"]')].filter(visible);
        const target = candidates.find(el => texts.some(text => (el.textContent || '').trim().toLowerCase() === text.toLowerCase()));
        if (!target) return JSON.stringify({ error: 'form-entry-not-found', buttons: candidates.map(el => (el.textContent || '').trim().slice(0, 40)).filter(Boolean).slice(-16) });
        target.click();
        return JSON.stringify({ ok: true });
      })()`).catch(() => '{}');
      try { formEntryState = JSON.parse(raw || '{}'); } catch { formEntryState = {}; }
      if (!formEntryState.error) break;
    }
    if (formEntryState.error) {
      throw new Error(`未找到创建密钥表单入口：${(formEntryState.buttons || []).join('、') || platform.formEntryTexts.join('、')}`);
    }
    await sleep(350);
  }

  // Several consoles keep the list page mounted while an asynchronous route
  // transition loads the actual creation form. In that interval the page can
  // still contain unrelated buttons (for example the BCE AI assistant's
  // recommendations). Poll only for the configured form input or confirmation
  // action so those unrelated buttons can never be reported as the form.
  const formReadyAttempts = Math.max(1, Number(platform.formReadyAttempts) || 1);
  const formReadyDelayMs = Math.max(150, Number(platform.formReadyDelayMs) || 500);
  let formReadyState = { ready: formReadyAttempts === 1, nameInput: false, confirmButton: false, buttons: [] };
  for (let attempt = 0; attempt < formReadyAttempts; attempt += 1) {
    await sleep(attempt === 0 ? 1200 : formReadyDelayMs);
    const readyRaw = await execJs(`(() => {
      const selectors = ${JSON.stringify(platform.nameSelectors || [])};
      const confirmTexts = ${JSON.stringify(platform.confirmTexts || [])};
      const visible = el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled;
      };
      const scopes = [...document.querySelectorAll('[role="dialog"], .ant-modal, .modal, [class*="dialog"], [class*="modal"]'), document];
      const nameInput = selectors.length > 0 && scopes.some(scope => selectors.some(selector => {
        const input = scope.querySelector(selector);
        return Boolean(input && visible(input));
      }));
      const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
      const confirmButton = buttons.some(button => {
        const label = (button.textContent || '').trim().replace(/\\s+/g, '').toLowerCase();
        return confirmTexts.some(text => {
          const expected = String(text).replace(/\\s+/g, '').toLowerCase();
          return label === expected || label.startsWith(expected);
        });
      });
      return JSON.stringify({ ready: Boolean(nameInput || confirmButton), nameInput, confirmButton, buttons: buttons.map(button => (button.textContent || '').trim().slice(0, 40)).filter(Boolean).slice(-16) });
    })()`).catch(() => '{}');
    try { formReadyState = JSON.parse(readyRaw || '{}'); } catch { formReadyState = {}; }
    if (formReadyState.ready) break;
  }
  if (formReadyAttempts > 1 && !formReadyState.ready) {
    throw new Error(`创建密钥表单加载超时：${(formReadyState.buttons || []).join('、') || '请确认已登录并拥有创建权限'}`);
  }
  // A name is optional across platforms. Populate it when the create dialog
  // exposes a conventional input; platforms that create unnamed keys continue.
  await execJs(`(() => {
    const selectors = ${JSON.stringify(platform.nameSelectors || [
      'input[placeholder*="名称"]',
      'input[placeholder*="Name"]',
      'input[placeholder*="描述"]',
      'input[name*="name" i]',
      'input[id*="name" i]',
    ])};
    const scopes = [...document.querySelectorAll('[role="dialog"], .ant-modal, .modal, [class*="dialog"], [class*="modal"]'), document];
    for (const scope of scopes) {
      const input = selectors.map(selector => scope.querySelector(selector)).find(Boolean);
      if (!input || input.disabled || input.getBoundingClientRect().width === 0) continue;
      const prototype = input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(input, ${JSON.stringify(uniqueName)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    }
    return 'no-name-input';
  })()`).catch(() => 'no-name-input');

  // Do not misreport a disabled platform prerequisite as a failed click or a
  // possibly-created key. These are explicitly verified, non-secret messages
  // rendered inside the provider's own create form.
  if (platform.formBlockers?.length) {
    const formBlocker = await execJs(`(() => {
      const visibleText = document.body?.innerText || '';
      const blockers = ${JSON.stringify(platform.formBlockers)};
      return JSON.stringify(blockers.find(blocker => visibleText.includes(blocker.text)) || null);
    })()`).catch(() => 'null');
    let blocker;
    try { blocker = JSON.parse(formBlocker || 'null'); } catch {}
    if (blocker?.message) throw new Error(blocker.message);
  }

  // Kimi's form requires an explicit project. Choosing a different project
  // would change the scope of the created credential, so only the provider's
  // visible `default` project is eligible for automatic selection.
  if (platform.defaultProjectLabel) {
    const openProject = await execJs(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"], .ant-modal, .modal, [class*="dialog"], [class*="modal"]')]
        .find(el => el.getBoundingClientRect().width > 0) || document;
      const input = dialog.querySelector('input[role="combobox"]');
      if (!input) return JSON.stringify({ error: 'project-select-not-found' });
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      input.click();
      return JSON.stringify({ ok: true });
    })()`);
    let projectOpenState = {};
    try { projectOpenState = JSON.parse(openProject || '{}'); } catch {}
    if (projectOpenState.error) throw new Error('未找到 Kimi 项目选择框');

    await sleep(300);
    const selectProject = await execJs(`(() => {
      const label = ${JSON.stringify(platform.defaultProjectLabel)}.toLowerCase();
      const visible = el => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const options = [...document.querySelectorAll('[role="option"], .ant-select-item-option')]
        .filter(visible);
      const option = options.find(el => {
        const text = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
        return text === label || text.startsWith(label + ' ');
      });
      if (!option) return JSON.stringify({ error: 'default-project-not-found', options: options.map(el => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60)) });
      const rect = option.getBoundingClientRect();
      return JSON.stringify({ ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    })()`);
    let projectSelectState = {};
    try { projectSelectState = JSON.parse(selectProject || '{}'); } catch {}
    if (projectSelectState.error) {
      throw new Error(`未找到 Kimi 默认项目：${(projectSelectState.options || []).join('、') || platform.defaultProjectLabel}`);
    }
    // React's Ant Design select ignores synthetic element.click() in this
    // console. Dispatch a real CDP mouse gesture at the verified option.
    if (!Number.isFinite(projectSelectState.x) || !Number.isFinite(projectSelectState.y)) {
      throw new Error('无法定位 Kimi 默认项目的位置');
    }
    const projectMouseParams = {
      x: projectSelectState.x,
      y: projectSelectState.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    };
    const projectPressed = await sendCommand('cdp', {
      cdpMethod: 'Input.dispatchMouseEvent',
      cdpParams: { ...projectMouseParams, type: 'mousePressed' },
      workspace: 'okit',
      ...(tabId ? { tabId } : {}),
    }, 5000);
    const projectReleased = await sendCommand('cdp', {
      cdpMethod: 'Input.dispatchMouseEvent',
      cdpParams: { ...projectMouseParams, type: 'mouseReleased', buttons: 0 },
      workspace: 'okit',
      ...(tabId ? { tabId } : {}),
    }, 5000);
    if (!projectPressed.ok || !projectReleased.ok) {
      throw new Error('无法选择 Kimi 默认项目');
    }
    await sleep(300);
  }

  await sleep(500);
  if (!platform.creationActionOnly) {
    const confirmResult = await execJs(`(() => {
    const confirmTexts = ${JSON.stringify(platform.confirmTexts || ['确定', '确认', '创建', '保存', 'Create', 'Confirm', 'Save', 'Generate'])};
    const createTexts = ${JSON.stringify(platform.createTexts || [])};
    const scope = document.querySelector('[role="dialog"], .ant-modal, .modal, [class*="dialog"], [class*="modal"]') || document;
    const visibleButtons = (root) => [...root.querySelectorAll('button, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled;
    });
    const scopedCandidates = visibleButtons(scope);
    // Some consoles render their create form in a sheet that is not the
    // element matching [role=dialog]. Search the full page as a fallback.
    const candidates = [...new Set([...scopedCandidates, ...visibleButtons(document)])];
    const target = candidates.find(el => {
      const label = (el.textContent || '').trim();
      // Ant Design may render Chinese labels with layout whitespace, e.g.
      // "确 定" instead of "确定". Match by the visible words, not spacing.
      const normalizedLabel = label.replace(/\\s+/g, '').toLowerCase();
      return confirmTexts.some(text => {
        const normalizedText = text.replace(/\\s+/g, '').toLowerCase();
        return normalizedLabel === normalizedText || normalizedLabel.startsWith(normalizedText);
      }) && (${Boolean(platform.allowConfirmCreateText)} || !createTexts.some(text => normalizedLabel.includes(text.replace(/\\s+/g, '').toLowerCase())));
    });
    if (!target) return JSON.stringify({ error: 'confirm-not-found', buttons: candidates.map(el => (el.textContent || '').trim().slice(0, 40)) });
    target.click();
    return JSON.stringify({ ok: true });
  })()`);
  let confirmState = {};
  try { confirmState = JSON.parse(confirmResult || '{}'); } catch {}
    if (confirmState.error) throw new Error(`创建对话框需要补充项目、计费或权限设置后再确认：${(confirmState.buttons || []).join('、')}`);
  }

  // Some consoles (including Mistral) put the one-time secret directly into
  // an input in their success dialog. Read that short-lived field before the
  // potentially slow full network-capture read; otherwise the dialog can be
  // gone before we inspect its value.
  const readDomKey = async () => {
    const domText = await execJs(`(() => {
      const selectors = ${JSON.stringify(platform.postCreateKeySelectors || [])};
      const fields = selectors.length
        ? [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
        : [...document.querySelectorAll('input, textarea, [data-clipboard-text], [data-key]')];
      const values = fields
        .map(el => el.value || el.getAttribute('data-clipboard-text') || el.getAttribute('data-key') || '');
      return selectors.length ? values.join('\\n') : [document.body.innerText || '', ...values].join('\\n');
    })()`).catch(() => '');
    return keyFromText(domText, platform);
  };

  const domReadAttempts = Math.max(1, Number(platform.postCreateDomReadAttempts) || 1);
  let immediateDomKey = null;
  for (let attempt = 0; attempt < domReadAttempts; attempt += 1) {
    await sleep(attempt === 0 ? 500 : 350);
    immediateDomKey = await readDomKey();
    if (immediateDomKey) break;
  }
  // A few consoles reveal the secret only after the user clicks Copy. Install
  // a capture hook before invoking only the explicitly verified post-create
  // Copy action below. The value is returned only to the vault flow and is
  // never logged.
  const hasPostCreateCopy = Boolean(platform.postCreateCopyTexts?.length || platform.postCreateRowCopySelector || platform.postCreateCopyByMaskedKeyPrefix);
  if (hasPostCreateCopy) {
    await execJs(`(() => {
      window.__okitCapturedKey = '';
      window.__okitCopyCaptureInfo = { source: '', length: 0, clipboardHooked: false, clipboardWriteHooked: false, execHooked: false };
      const capture = (value, source) => {
        const text = String(value || '');
        if (!text) return;
        window.__okitCapturedKey = text;
        window.__okitCopyCaptureInfo.source = source;
        window.__okitCopyCaptureInfo.length = text.length;
      };
      const captureSelectedControl = (control, source) => {
        if (!control || typeof control.value !== 'string') return;
        const start = Number.isFinite(control.selectionStart) ? control.selectionStart : 0;
        const end = Number.isFinite(control.selectionEnd) ? control.selectionEnd : control.value.length;
        capture(control.value.slice(start, end) || control.value, source);
      };
      try {
        if (navigator.clipboard?.writeText) {
          const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
          const wrappedWriteText = function(text) {
            capture(text, 'clipboard.writeText');
            return originalWriteText(text);
          };
          // Most Chromium builds accept the instance override. Some expose a
          // non-writable instance slot, so fall back to the Clipboard
          // prototype without ever querying the system clipboard.
          try { navigator.clipboard.writeText = wrappedWriteText; } catch {}
          if (navigator.clipboard.writeText !== wrappedWriteText) {
            try { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: wrappedWriteText }); } catch {}
          }
          if (navigator.clipboard.writeText !== wrappedWriteText) {
            try { Object.defineProperty(Object.getPrototypeOf(navigator.clipboard), 'writeText', { configurable: true, value: wrappedWriteText }); } catch {}
          }
          window.__okitCopyCaptureInfo.clipboardHooked = navigator.clipboard.writeText === wrappedWriteText;
        }
      } catch {}
      try {
        if (navigator.clipboard?.write) {
          const originalWrite = navigator.clipboard.write.bind(navigator.clipboard);
          const wrappedWrite = function(items) {
            // Clipboard.write may receive a ClipboardItem instead of a plain
            // string. Inspect only the text item supplied by this page action;
            // do not call Clipboard.read or Clipboard.readText.
            for (const item of (items || [])) {
              if (!item?.types?.includes?.('text/plain')) continue;
              item.getType('text/plain').then(blob => blob.text()).then(text => capture(text, 'clipboard.write')).catch(() => {});
            }
            return originalWrite(items);
          };
          try { navigator.clipboard.write = wrappedWrite; } catch {}
          if (navigator.clipboard.write !== wrappedWrite) {
            try { Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: wrappedWrite }); } catch {}
          }
          if (navigator.clipboard.write !== wrappedWrite) {
            try { Object.defineProperty(Object.getPrototypeOf(navigator.clipboard), 'write', { configurable: true, value: wrappedWrite }); } catch {}
          }
          window.__okitCopyCaptureInfo.clipboardWriteHooked = navigator.clipboard.write === wrappedWrite;
        }
      } catch {}
      try {
        const originalExecCommand = document.execCommand.bind(document);
        document.execCommand = function(command) {
          if (String(command).toLowerCase() === 'copy') {
            // Libraries that implement Copy with a temporary <input> or
            // <textarea> do not populate window.getSelection(). Read only the
            // selection that this page has just made, never the system
            // clipboard. This keeps the capture scoped to the provider action.
            const active = document.activeElement;
            const selected = window.getSelection()?.toString() || '';
            capture(selected, 'document-selection');
            if (!selected) captureSelectedControl(active, 'active-control');
          }
          return originalExecCommand(command);
        };
        window.__okitCopyCaptureInfo.execHooked = document.execCommand !== originalExecCommand;
      } catch {}
      // Copy-helper libraries commonly select a short-lived input
      // and invoke the browser's native copy routine. Record that value when
      // it is selected, rather than reading any external clipboard state.
      for (const Prototype of [window.HTMLInputElement?.prototype, window.HTMLTextAreaElement?.prototype]) {
        if (!Prototype?.select || Prototype.__okitCopyHooked) continue;
        try {
          const originalSelect = Prototype.select;
          Prototype.select = function(...args) {
            captureSelectedControl(this, 'control-select');
            return originalSelect.apply(this, args);
          };
          Object.defineProperty(Prototype, '__okitCopyHooked', { value: true });
        } catch {}
      }
      document.addEventListener('copy', () => {
        const selected = window.getSelection()?.toString() || '';
        capture(selected, 'copy-event-selection');
        if (!selected) captureSelectedControl(document.activeElement, 'copy-event-control');
      }, true);
      // Some UI libraries populate event.clipboardData in their own Copy
      // handler. Capture it during bubbling, after that handler has run. This
      // observes only the provider's current copy event and never reads the
      // system clipboard.
      document.addEventListener('copy', (event) => {
        capture(event.clipboardData?.getData('text/plain') || '', 'copy-event-data');
      });
      return 'capture-ready';
    })()`).catch(() => {});
  }

  const requiresCopyCapture = Boolean(platform.requirePostCreateCopy);
  if (immediateDomKey && !requiresCopyCapture) {
    await closeAutomationWindow();
    return { value: immediateDomKey, name: uniqueName };
  }

  const copyAttempts = Math.max(0, Number(platform.postCreateCopyAttempts) || 0);
  for (let attempt = 0; attempt < copyAttempts; attempt += 1) {
    const retryDelay = Math.max(100, Number(platform.postCreateCopyRetryMs) || 500);
    await sleep(attempt === 0 ? 350 : retryDelay);
    const copyResult = await execJs(`(() => {
      const texts = ${JSON.stringify(platform.postCreateCopyTexts || [])};
      const rowCopySelector = ${JSON.stringify(platform.postCreateRowCopySelector || '')};
      const maskedKeyPrefix = ${JSON.stringify(platform.postCreateCopyByMaskedKeyPrefix || '')};
      const createdName = ${JSON.stringify(uniqueName)};
      const visible = el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.disabled;
      };
      let copyAction = null;
      if (rowCopySelector) {
        // Z.AI masks the API key cell but exposes a verified SVG copy icon in
        // that same row. Scope the click to the name we just created so an
        // unrelated existing credential can never be copied or saved.
        const createdRow = [...document.querySelectorAll('tr')]
          .find(row => (row.innerText || '').includes(createdName));
        const copyIcon = createdRow?.querySelector(rowCopySelector);
        // Z.AI binds its handler directly to the SVG. Clicking its decorative
        // wrapping span produces a pointer event but does not invoke the
        // provider's copy action, leaving the old clipboard value in place.
        copyAction = copyIcon?.closest('button, a, [role="button"]') || copyIcon || null;
      } else if (maskedKeyPrefix) {
        // Xiaomi's Token Plan list shows the newly-created key in a masked
        // paragraph and exposes two icon-only buttons in the same row. The
        // first button is the provider's Copy action; the second resets the
        // key and must never be clicked automatically.
        // The configured prefix is a literal provider marker (currently
        // tp-), so it is intentionally not treated as a regular expression.
        const escapedPrefix = maskedKeyPrefix;
        const maskedPattern = new RegExp('^' + escapedPrefix + '[A-Za-z0-9_-]{5,}\\\\*{3,}[A-Za-z0-9_-]*$');
        const keyNode = [...document.querySelectorAll('p, span, div')]
          .filter(visible)
          .map(el => ({ el, text: (el.textContent || '').trim() }))
          .filter(item => maskedPattern.test(item.text))
          .sort((a, b) => a.text.length - b.text.length)[0]?.el;
        let row = keyNode;
        for (let depth = 0; row && depth < 5; depth += 1, row = row.parentElement) {
          const buttons = [...row.querySelectorAll('button, a, [role="button"]')].filter(visible);
          if (buttons.length) {
            copyAction = buttons[0];
            break;
          }
        }
      } else {
        copyAction = [...document.querySelectorAll('button, a, [role="button"]')]
          .filter(visible)
          .find(el => texts.some(text => (el.textContent || '').trim().toLowerCase() === text.toLowerCase()));
      }
      if (!copyAction || !visible(copyAction)) {
        return JSON.stringify({ clicked: false, rowFound: Boolean(rowCopySelector && [...document.querySelectorAll('tr')].some(row => (row.innerText || '').includes(createdName))) });
      }
      if (rowCopySelector) {
        const rect = copyAction.getBoundingClientRect();
        // Z.AI's React handler is attached to the clickable wrapper around
        // the SVG. Invoke that verified same-row action once before the
        // foregrounded CDP pointer event below; the latter remains the
        // trusted-input fallback for builds that ignore synthetic clicks.
        const clickTarget = copyAction.parentElement || copyAction;
        try {
          clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          clickTarget.click?.();
        } catch {}
        return JSON.stringify({
          clicked: Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0,
          rowFound: true,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        });
      }
      const rect = copyAction.getBoundingClientRect();
      copyAction.click();
      return JSON.stringify({
        clicked: rect.width > 0 && rect.height > 0,
        rowFound: true,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      });
    })()`).catch(() => '{}');
    let copyState = {};
    try { copyState = JSON.parse(copyResult || '{}'); } catch {}
    if (!copyState.clicked) {
      console.log(`[auto-create] ${platform.id}: created-row copy action not ready (row found: ${Boolean(copyState.rowFound)})`);
      continue;
    }
    if (platform.postCreateRowCopySelector) {
      // The Z.AI list copy icon handles only trusted user input. Dispatch real
      // DevTools mouse events instead of Element.click(), using coordinates
      // calculated from the exact row created by this attempt.
      const pointer = { x: Number(copyState.x), y: Number(copyState.y), button: 'left', buttons: 1, clickCount: 1 };
      if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) {
        console.log(`[auto-create] ${platform.id}: created-row copy control had no usable coordinates`);
        continue;
      }
      // Clipboard writes triggered by a real pointer event are permitted only
      // when the provider page's window is foregrounded. The automation window
      // deliberately stays in the background for normal navigation, so bring
      // it forward only for this exact verified Copy action.
      const focused = await sendCommand('focus-window', {
        workspace: 'okit',
      }, 5000).catch(() => ({ ok: false }));
      if (!focused.ok) {
        console.log(`[auto-create] ${platform.id}: could not foreground copy window`);
        continue;
      }
      await sleep(150);
      const pressed = await sendCommand('cdp', {
        cdpMethod: 'Input.dispatchMouseEvent',
        cdpParams: { ...pointer, type: 'mousePressed' },
        workspace: 'okit',
        ...(tabId ? { tabId } : {}),
      }, 5000).catch(() => ({ ok: false }));
      const released = await sendCommand('cdp', {
        cdpMethod: 'Input.dispatchMouseEvent',
        cdpParams: { ...pointer, type: 'mouseReleased', buttons: 0 },
        workspace: 'okit',
        ...(tabId ? { tabId } : {}),
      }, 5000).catch(() => ({ ok: false }));
      if (!pressed.ok || !released.ok) {
        console.log(`[auto-create] ${platform.id}: created-row copy pointer dispatch failed`);
        continue;
      }
    } else if (platform.postCreateCopyNeedsForeground) {
      const pointer = { x: Number(copyState.x), y: Number(copyState.y), button: 'left', buttons: 1, clickCount: 1 };
      if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) continue;
      const focused = await sendCommand('focus-window', { workspace: 'okit' }, 5000).catch(() => ({ ok: false }));
      if (!focused.ok) continue;
      await sleep(150);
      const pressed = await sendCommand('cdp', {
        cdpMethod: 'Input.dispatchMouseEvent',
        cdpParams: { ...pointer, type: 'mousePressed' },
        workspace: 'okit', ...(tabId ? { tabId } : {}),
      }, 5000).catch(() => ({ ok: false }));
      const released = await sendCommand('cdp', {
        cdpMethod: 'Input.dispatchMouseEvent',
        cdpParams: { ...pointer, type: 'mouseReleased', buttons: 0 },
        workspace: 'okit', ...(tabId ? { tabId } : {}),
      }, 5000).catch(() => ({ ok: false }));
      if (!pressed.ok || !released.ok) continue;
    }
    if (platform.allowExtensionClipboardRead) {
      // The copy UI may use Chrome's native clipboard path, which cannot be
      // observed from page JavaScript. The extension only returns the value
      // if the entire clipboard text matches this platform's key format.
      await sleep(500);
      const clipboardRead = await sendCommand('clipboard-read', {
        workspace: 'okit',
        clipboardPattern: platform.keyPatterns?.[0] || '',
        clipboardAllowSurrounding: platform.id === 'zai-global',
      }, 5000).catch((error) => ({ ok: false, data: {}, error: error?.message || String(error) }));
      const clipboardDiag = clipboardRead.ok
        ? { matched: Boolean(clipboardRead.data?.matched), length: Number(clipboardRead.data?.length) || 0 }
        : { matched: false, length: 0, error: String(clipboardRead.error || 'read-failed').slice(0, 120) };
      console.log(`[auto-create] ${platform.id}: extension clipboard ${JSON.stringify(clipboardDiag)}`);
      const clipboardValue = clipboardRead.ok && clipboardRead.data?.matched
        ? clipboardRead.data.value
        : '';
      const clipboardKey = keyFromText(clipboardValue, platform);
      if (clipboardKey) {
        await closeAutomationWindow();
        return { value: clipboardKey, name: uniqueName };
      }
    }
    // Clipboard APIs are asynchronous in some consoles. The interceptor above
    // records only the text supplied by this explicit provider Copy action; it
    // never reads the user's system clipboard.
    await sleep(250);
    const copiedText = await execJs('window.__okitCapturedKey || ""').catch(() => '');
    const captureInfo = await execJs(`(() => JSON.stringify({
      source: window.__okitCopyCaptureInfo?.source || '',
      length: Number(window.__okitCopyCaptureInfo?.length) || 0,
      clipboardHooked: Boolean(window.__okitCopyCaptureInfo?.clipboardHooked),
      clipboardWriteHooked: Boolean(window.__okitCopyCaptureInfo?.clipboardWriteHooked),
      execHooked: Boolean(window.__okitCopyCaptureInfo?.execHooked),
    }))()`).catch(() => '{}');
    console.log(`[auto-create] ${platform.id}: created-row copy capture ${captureInfo}`);
    const copiedKey = keyFromText(copiedText, platform);
    if (copiedKey) {
      await closeAutomationWindow();
      return { value: copiedKey, name: uniqueName };
    }
    // A few copy controls request the secret from the provider and copy it
    // without using a patchable Clipboard API. The capture is armed before
    // creation, so inspect only the responses produced by this creation/copy
    // flow as a fallback. Validation still rejects masked values.
    const copyNetwork = await sendCommand('network-capture-read', {
      workspace: 'okit',
      ...(tabId ? { tabId } : {}),
    }, 10000).catch(() => ({ ok: false, data: [] }));
    const copyEntries = copyNetwork.ok ? (copyNetwork.data || []) : [];
    const networkKey = keyFromText(extractKeyFromCaptures(copyEntries, platform.id), platform);
    if (networkKey) {
      await closeAutomationWindow();
      return { value: networkKey, name: uniqueName };
    }
    if (copyEntries.length) {
      console.log(`[auto-create] ${platform.id}: created-row copy network responses ${copyEntries.length}`);
    }
  }
  if (requiresCopyCapture) {
    throw new Error(platform.postCreateCopyFailureMessage || '创建成功页未能通过 Copy 按钮读取一次性明文；为避免保存非密钥内容，已停止保存。');
  }

  // Some consoles create the credential first and render its one-time secret
  // a few seconds later. Keep reading the same creation attempt rather than
  // submitting again, which would create duplicate keys.
  const readAttempts = Math.max(1, Number(platform.postCreateReadAttempts) || 1);
  const entries = [];
  for (let attempt = 0; attempt < readAttempts; attempt += 1) {
    await sleep(attempt === 0 ? 2500 : 1500);
    const read = await sendCommand('network-capture-read', { workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
    if (!read.ok) throw new Error(read.error || '无法读取创建结果');
    entries.push(...(read.data || []));

    const captured = extractKeyFromCaptures(entries, platform.id);
    const capturedKey = keyFromText(captured, platform);
    if (captured && !capturedKey) {
      // Do not log the candidate. Its length and validation result are enough
      // to diagnose a provider format change without leaking a credential.
      console.log(`[auto-create] ${platform.id}: captured key-shaped value rejected by platform pattern (length ${captured.length})`);
    }
    if (capturedKey) {
      await closeAutomationWindow();
      return { value: capturedKey, name: uniqueName };
    }

    const domKey = await readDomKey();
    if (domKey) {
      await closeAutomationWindow();
      return { value: domKey, name: uniqueName };
    }
  }

  const secretDiagnostics = describeCapturedSecretFields(entries);
  if (platform.maskedSecretMessage && capturesContainMaskedSecret(entries)) {
    throw new Error(platform.maskedSecretMessage);
  }
  if (secretDiagnostics.length) {
    console.log('[auto-create] safe secret-field diagnostics', JSON.stringify(secretDiagnostics));
  }
  throw new Error(`密钥可能已创建，但未能读取一次性明文（已抓取 ${entries.length} 条请求）。请在自动化窗口复制密钥后手动保存。`);
}

async function createBrowserPlatformKey(platform, tokenName) {
  const ORCHESTRATORS = {
    zhipu: createZhipuKey,
    volcengine: createVolcengineKey,
    minimax: createMinimaxKey,
  };
  const orchestrator = ORCHESTRATORS[platform.id]
    || ((params) => createGenericBrowserKey({ ...params, platform }));
  return orchestrator({ tokenName });
}

/** Recover the newest already-created Z.AI key without creating another one. */
async function recoverLatestZaiGlobalKey() {
  const platform = AUTO_CREATE_PLATFORM_MAP.get('zai-global');
  if (!platform) throw new Error('Z.AI platform metadata unavailable');
  const nav = await sendCommand('navigate', { url: platform.url, workspace: 'okit' }, 30000);
  if (!nav.ok) throw new Error(nav.error || '打开 Z.AI 密钥列表失败');
  const tabId = nav.data && nav.data.tabId;
  const capStart = await sendCommand('network-capture-start', {
    pattern: '', workspace: 'okit', ...(tabId ? { tabId } : {}),
  }, 10000);
  if (!capStart.ok) throw new Error(capStart.error || '无法开始 Z.AI 复制接口抓取');
  await sleep(7000);
  const raw = await execJs(`(() => {
    const rows = [...document.querySelectorAll('tr')]
      .filter(row => /^ZAI_API_KEY-/i.test((row.innerText || '').trim()));
    const row = rows[rows.length - 1];
    const icon = row?.querySelector('svg.lucide-copy');
    if (!row || !icon) return JSON.stringify({ error: !row ? 'row-not-found' : 'copy-not-found' });
    const target = icon.parentElement || icon;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    target.click?.();
    const rect = icon.getBoundingClientRect();
    const parentRect = target.getBoundingClientRect();
    return JSON.stringify({
      name: (row.querySelector('td')?.innerText || '').trim(),
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      visible: rect.width > 0 && rect.height > 0,
      parentX: parentRect.x + parentRect.width / 2,
      parentY: parentRect.y + parentRect.height / 2,
    });
  })()`).catch(() => '{}');
  let meta = {};
  try { meta = JSON.parse(raw || '{}'); } catch {}
  if (meta.error) throw new Error(`Z.AI 最近已创建行不可恢复：${meta.error}`);
  if (!meta.visible || !Number.isFinite(meta.x) || !Number.isFinite(meta.y)) {
    throw new Error('Z.AI 最近已创建行的复制控件不可用');
  }
  await execJs(`(() => {
    window.__okitRecoveryCopied = '';
    if (window.__okitRecoveryCopyHooked) return 'already-hooked';
    const capture = value => { if (typeof value === 'string' && value) window.__okitRecoveryCopied = value; };
    try {
      if (navigator.clipboard?.writeText) {
        const original = navigator.clipboard.writeText.bind(navigator.clipboard);
        const wrapped = text => { capture(String(text || '')); return original(text); };
        try { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: wrapped }); } catch {}
      }
    } catch {}
    document.addEventListener('copy', event => {
      capture(event.clipboardData?.getData('text/plain') || '');
      const selected = window.getSelection()?.toString() || '';
      capture(selected);
    });
    window.__okitRecoveryCopyHooked = true;
    return 'hooked';
  })()`).catch(() => 'hook-failed');
  const focused = await sendCommand('focus-window', { workspace: 'okit' }, 5000);
  if (!focused.ok) throw new Error('无法将 Z.AI 复制窗口置前');
  await sleep(150);
  const pointer = { x: meta.x, y: meta.y, button: 'left', buttons: 1, clickCount: 1 };
  const pressed = await sendCommand('cdp', {
    cdpMethod: 'Input.dispatchMouseEvent',
    cdpParams: { ...pointer, type: 'mousePressed' },
    workspace: 'okit', ...(tabId ? { tabId } : {}),
  }, 5000);
  const released = await sendCommand('cdp', {
    cdpMethod: 'Input.dispatchMouseEvent',
    cdpParams: { ...pointer, type: 'mouseReleased', buttons: 0 },
    workspace: 'okit', ...(tabId ? { tabId } : {}),
  }, 5000);
  if (!pressed.ok || !released.ok) throw new Error('Z.AI 最近已创建行复制点击失败');
  await sleep(500);
  const copiedNetwork = await sendCommand('network-capture-read', {
    workspace: 'okit', ...(tabId ? { tabId } : {}),
  }, 10000).catch(() => ({ ok: false, data: [] }));
  const copiedNetworkKey = copiedNetwork.ok
    ? keyFromText(extractKeyFromCaptures(copiedNetwork.data || [], 'zai-global'), platform)
    : null;
  if (copiedNetworkKey) {
    const { VaultStore } = require('../../vault/store');
    const vault = new VaultStore();
    await vault.set(platform.keyHint, copiedNetworkKey, platform.groupHint);
    await closeAutomationWindow();
    return { name: meta.name || 'latest', valueLength: copiedNetworkKey.length };
  }
  if (copiedNetwork.ok) {
    console.log('[auto-create] zai recovery copy response shapes', JSON.stringify({
      entries: describeCapturedResponses(copiedNetwork.data || []),
      secretFields: describeCapturedSecretFields(copiedNetwork.data || []),
    }));
  }
  const pageCopied = await execJs('window.__okitRecoveryCopied || ""').catch(() => '');
  const pageKey = keyFromText(pageCopied, platform);
  if (pageKey) {
    const { VaultStore } = require('../../vault/store');
    const vault = new VaultStore();
    await vault.set(platform.keyHint, pageKey, platform.groupHint);
    await closeAutomationWindow();
    return { name: meta.name || 'latest', valueLength: pageKey.length };
  }
  // A few React builds attach the handler to the icon wrapper rather than the
  // SVG node. Retry that exact same existing row once at the parent center.
  if (Number.isFinite(meta.parentX) && Number.isFinite(meta.parentY)) {
    const parentPointer = { x: meta.parentX, y: meta.parentY, button: 'left', buttons: 1, clickCount: 1 };
    await sendCommand('cdp', {
      cdpMethod: 'Input.dispatchMouseEvent',
      cdpParams: { ...parentPointer, type: 'mousePressed' },
      workspace: 'okit', ...(tabId ? { tabId } : {}),
    }, 5000);
    await sendCommand('cdp', {
      cdpMethod: 'Input.dispatchMouseEvent',
      cdpParams: { ...parentPointer, type: 'mouseReleased', buttons: 0 },
      workspace: 'okit', ...(tabId ? { tabId } : {}),
    }, 5000);
    await sleep(500);
    const parentCopied = await execJs('window.__okitRecoveryCopied || ""').catch(() => '');
    const parentKey = keyFromText(parentCopied, platform);
    if (parentKey) {
      const { VaultStore } = require('../../vault/store');
      const vault = new VaultStore();
      await vault.set(platform.keyHint, parentKey, platform.groupHint);
      await closeAutomationWindow();
      return { name: meta.name || 'latest', valueLength: parentKey.length };
    }
  }
  const clipboardRead = await sendCommand('clipboard-read', {
    workspace: 'okit', clipboardPattern: platform.keyPatterns[0], clipboardAllowSurrounding: true,
  }, 5000);
  const value = clipboardRead.ok && clipboardRead.data?.matched ? clipboardRead.data.value : '';
  const key = keyFromText(value, platform);
  if (!key) throw new Error(`Z.AI 最近已创建行复制内容无法通过格式校验（长度 ${Number(clipboardRead.data?.length) || 0}）`);
  const { VaultStore } = require('../../vault/store');
  const vault = new VaultStore();
  await vault.set(platform.keyHint, key, platform.groupHint);
  await closeAutomationWindow();
  return { name: meta.name || 'latest', valueLength: key.length };
}

function listAutoCreatePlatforms(_req, res) {
  // Do not expose selectors or implementation details to the browser.
  res.json({
    platforms: AUTO_CREATE_PLATFORMS.map(({ id, label, keyHint, groupHint, mode }) => ({ id, label, keyHint, groupHint, mode })),
  });
}

/**
 * Open every currently unverified provider console in the dedicated automation
 * Chrome window. This never creates a key or reads credentials; it only gives
 * the user one place to finish each official login before verification runs.
 */
async function openVerificationLoginTabs(_req, res) {
  if (!isExtensionConnected()) {
    return res.status(503).json({ error: 'OKIT Chrome 扩展未连接。' });
  }
  try {
    const [first, ...remaining] = BROWSER_LOGIN_VERIFICATION_PLATFORMS;
    if (!first) return res.json({ opened: [], browserFocused: false });

    const initial = await sendCommand('navigate', { url: first.url, workspace: 'okit' }, 30000);
    if (!initial.ok) throw new Error(initial.error || `无法打开 ${first.label}`);

    for (const platform of remaining) {
      const opened = await sendCommand('tabs', { op: 'new', url: platform.url, workspace: 'okit' }, 15000);
      if (!opened.ok) throw new Error(opened.error || `无法打开 ${platform.label}`);
    }

    const browserFocused = await focusAutomationWindow();
    return res.json({
      opened: BROWSER_LOGIN_VERIFICATION_PLATFORMS.map(({ id, label }) => ({ id, label })),
      browserFocused,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

// ─── Routes ────────────────────────────────────────────────────────

const SUPPORTED = AUTO_CREATE_PLATFORMS.map(platform => platform.id);

async function autoCreateKey(req, res) {
  try {
    const { platform, tokenName, parentToken } = req.body;
    if (!platform || !tokenName) return res.status(400).json({ error: 'platform and tokenName are required' });
    if (!SUPPORTED.includes(platform)) return res.status(400).json({ error: `Unknown platform: ${platform}` });
    const platformConfig = AUTO_CREATE_PLATFORM_MAP.get(platform);

    // Cloudflare: API direct
    if (platform === 'cloudflare') {
      if (!parentToken) return res.status(400).json({ error: 'Cloudflare requires a parent token.' });
      const result = await createCloudflareToken({ parentToken, tokenName });
      return res.json({ success: true, ...result });
    }

    // Browser platforms: use Chrome Extension (no login needed — shares cookies)
    if (!isExtensionConnected()) {
      return res.status(503).json({
        success: false,
        error: 'OKIT Chrome 扩展未连接。请先安装扩展：chrome://extensions → 加载已解压的扩展程序 → 选择 okit/extension 目录',
      });
    }

    try {
      const result = await createBrowserPlatformKey(platformConfig, tokenName);
      if (isAssetData(result.value)) {
        return res.status(500).json({ success: false, error: 'Extracted asset data, not API key.' });
      }
      return res.json({
        success: true,
        value: result.value,
        name: result.name,
        platform,
        ...(platformConfig.readyAfterMs ? { readyAfterMs: platformConfig.readyAfterMs } : {}),
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/not connected|disconnected|timed out/i.test(msg)) {
        return res.status(503).json({ success: false, error: msg });
      }
      const loginState = await detectLoginRequired();
      if (isLoginFailure(msg) || loginState.loginRequired) {
        const browserFocused = await focusAutomationWindow();
        const label = platformConfig?.label || platform;
        return res.status(401).json({
          success: false,
          loginRequired: true,
          browserFocused,
          loginUrl: loginState.url || platformConfig?.url,
          error: browserFocused
            ? `需要登录 ${label}。已将自动化浏览器窗口置前，请完成登录后回到 OKIT 重试。`
            : `需要登录 ${label}。请在 OKIT 自动化浏览器窗口完成登录后重试。`,
        });
      }
      return res.status(500).json({ success: false, error: `${platform} auto-create failed: ${msg}` });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Server-side key extraction ──────────────────────────────────

function isAssetData(v) {
  if (!v) return true;
  if (v.startsWith('iVBOR') || v.startsWith('/9j/') || v.startsWith('R0lGOD')) return true;
  if (v.startsWith('AAEA') || v.startsWith('d09G') || v.startsWith('T1Rc')) return true;
  if (/^\d+\.\d/.test(v)) return true;
  if (v.includes('h117.') || v.includes('V296.')) return true;
  // Asterisks and bullets are provider-side masking, never valid credential
  // characters. Treat them as unavailable instead of storing a broken key.
  if (/[＊*•]/.test(v)) return true;
  if (v.includes(' ')) return true; // CSS class names, human text — not keys
  if (v.includes('flex') || v.includes('gap-') || v.includes('pointer') || v.includes('globalRuntime')) return true;
  return false;
}

function extractKeyFromHtml(html, platform) {
  if (!html) return null;
  const tokens = html.match(/[A-Za-z0-9+/=_-]{50,}/g) || [];
  const filtered = tokens
    .filter(g => !isAssetData(g))
    .filter(g => /[A-Z]/.test(g) && /[a-z]/.test(g) && /\d/.test(g))
    .filter(g => !g.includes('ant-') && !g.includes('css-') && !g.includes('-btn') && !g.includes('http'))
    .filter(g => !g.includes('/') || g.split('/').every(s => s.length < 40)) // filter file paths
    .filter(g => !g.includes('_next') && !g.includes('_buildManifest') && !g.includes('chunk'))
    .filter(g => g.length < 2000)
    .sort((a, b) => b.length - a.length);
  return filtered[0] || null;
}

/** GET /api/vault/cdp-status — check if Chrome Extension is connected */
async function cdpStatus(req, res) {
  const { getExtensionVersion, getExtensionProtocol } = require('./ws-extension');
  return res.json({
    available: isExtensionConnected(),
    version: getExtensionVersion(),
    protocol: getExtensionProtocol(),
  });
}

module.exports = {
  autoCreateKey,
  recoverLatestZaiGlobalKey,
  cdpStatus,
  listAutoCreatePlatforms,
  openVerificationLoginTabs,
  AUTO_CREATE_PLATFORMS,
  BROWSER_LOGIN_VERIFICATION_PLATFORMS,
  isLoginFailure,
  isLoginUrl,
  isOpenRouterPublicPage,
  hasOpenRouterPublicNavigation,
  extractKeyFromCaptures,
  describeCapturedSecretFields,
  capturesContainMaskedSecret,
  isAssetData,
};
