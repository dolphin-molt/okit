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
    candidates.push({ body, url: e.url || '', status: e.responseStatus });
  }

  // 1. Try parsing JSON bodies and pluck known key fields.
  //    For zhipu, the response has separate "api_key" and "api_secret" fields
  //    that must be joined as "api_key.api_secret".
  //    IMPORTANT: prefer POST responses (create API) over GET (list API), since
  //    the list API returns masked secrets while the create API has the full key.
  const sortedCandidates = [...candidates].sort((a, b) => {
    // POST first, then others
    const aPost = a.url.includes('POST') || /post/i.test(a.method || '') ? 0 : 1;
    const bPost = b.url.includes('POST') || /post/i.test(b.method || '') ? 0 : 1;
    return aPost - bPost;
  });
  for (const c of sortedCandidates) {
    let data;
    try { data = JSON.parse(c.body); } catch { continue; }

    // Diagnostic: log any body containing key/secret fields
    if (/api_key|api_secret|apikey|secret/i.test(c.body)) {
      console.log(`[auto-create] key-containing response from ${c.url.slice(0, 80)}: ${c.body.slice(0, 500)}`);
    }

    // zhipu-specific: look for api_key + api_secret pair
    const keyId = findFieldValue(data, ['api_key', 'apikey', 'key']);
    const secret = findFieldValue(data, ['api_secret', 'apikeysecret', 'secret_key', 'secret']);
    if (keyId && secret && !isAssetData(keyId) && !isAssetData(secret)) {
      return keyId + '.' + secret;
    }

    // Generic: single key-like field
    const found = findKeyField(data);
    if (found && !isAssetData(found)) return found;
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
  const KEY_NAMES = ['apikey', 'api_key', 'apikeysecret', 'key', 'token', 'value', 'secret', 'secret_key'];
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
    console.log('[auto-create] zhipu: captured from clipboard →', capturedKey ? capturedKey.slice(0, 20) + '...' : '(empty)');
    if (capturedKey && capturedKey.includes('.')) {
      await closeAutomationWindow();
      return { value: capturedKey, name: uniqueName };
    }
  }

  // Diagnostic: dump all requests containing key/secret patterns + screenshot
  for (const e of entries) {
    const body = e.responsePreview || '';
    if (/api_key|api_secret|apikey|secret/i.test(body) || /api_keys/i.test(e.url || '')) {
      console.log(`[auto-create] zhipu: MATCH ${e.method} ${e.responseStatus} ${e.url.slice(0, 100)} → ${body.slice(0, 300)}`);
    }
  }
  // Screenshot to see what zhipu shows after creation
  try {
    const ss = await sendCommand('screenshot', { workspace: 'okit' }, 8000);
    if (ss.ok) require('fs').writeFileSync('/tmp/zhipu-after-create.png', Buffer.from(ss.data, 'base64'));
  } catch {}
  // Dump all text containing dot-separated keys
  const domDiag = await execJs(`(() => {
    const text = document.body.innerText || '';
    // Find all hex-dot-alphanumeric patterns
    const fullKeys = text.match(/[a-f0-9]{32}\.[a-zA-Z0-9]{4,}/g) || [];
    // Find all 32-hex patterns
    const hexKeys = text.match(/[a-f0-9]{32}/g) || [];
    return JSON.stringify({ fullKeys: fullKeys.slice(0, 5), hexKeys: hexKeys.slice(0, 5) });
  })()`).catch(() => '{}');
  console.log('[auto-create] zhipu: DOM key patterns →', domDiag);

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

// ─── Volcengine (火山引擎) — atomic-capability orchestration ──────
// Flow: navigate → arm capture → dismiss popups → click "创建" → handle
//       the "直接创建" intermediate dialog → fill name → confirm → read → extract.
// Known gotcha: volcengine shows a "直接创建" (Direct Create) option dialog
const VOLC_URL = 'https://console.volcengine.com/iam/keymanage/';
const VOLC_CREATE_TEXTS = ['创建 API Key', '创建 Access Key', '新建密钥', '创建密钥', '新建'];

/**
 * Volcengine flow (discovered via live debugging):
 *   1. Click "创建 API Key" → "安全风险提示" security dialog
 *   2. Click "继续" → dismisses the warning
 *   3. One of:
 *      a. "需要额外认证" SMS verification → user enters code manually
 *      b. Key created directly → "创建成功" success dialog
 *   4. Volcengine does NOT use a name input — keys are unnamed.
 *   5. The key arrives in a network response; captured via Network domain.
 * Semi-automatic: if SMS verification appears, inject banner + poll-wait.
 */
async function createVolcengineKey({ tokenName }) {
  const nav = await sendCommand('navigate', { url: VOLC_URL, workspace: 'okit' }, 30000);
  if (!nav.ok) throw new Error(nav.error || 'navigate failed');
  const tabId = nav.data && nav.data.tabId;
  console.log('[auto-create] volcengine: navigated (tab ' + tabId + ')');

  const capStart = await sendCommand('network-capture-start',
    { pattern: '', workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!capStart.ok) throw new Error(capStart.error || 'network-capture-start failed');
  console.log('[auto-create] volcengine: capture armed');

  await sleep(8000);

  // Click 创建 API Key
  await execJs(`(() => {
    const texts = ${JSON.stringify(VOLC_CREATE_TEXTS)};
    const els = [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled;
    });
    const btn = els.find(b => texts.some(t => b.textContent.includes(t)));
    if (btn) btn.click();
  })()`).catch(() => {});
  console.log('[auto-create] volcengine: create clicked');
  await sleep(2000);

  // Click 继续 in security dialog
  await execJs(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect(); return r.width > 0 && !b.disabled;
    });
    const cont = btns.find(b => /^继续$/.test(b.textContent.trim()));
    if (cont) cont.click();
  })()`).catch(() => {});
  console.log('[auto-create] volcengine: 继续 clicked');
  await sleep(3000);

  // Check page state
  let pageState = await checkVolcPageState();
  console.log('[auto-create] volcengine: after 继续 → ' + JSON.stringify(pageState));

  // If SMS verification needed, inject prompt and wait for user
  if (pageState.needsVerify && !pageState.createdSuccess) {
    console.log('[auto-create] volcengine: SMS verification required, waiting for user...');
    await injectVolcPrompt('⚡ OKIT — 请输入手机验证码完成验证,系统将自动继续。');
    let waited = 0;
    while (waited < 180000) {
      await sleep(3000);
      waited += 3000;
      pageState = await checkVolcPageState();
      if (pageState.createdSuccess) {
        console.log('[auto-create] volcengine: key created after ' + (waited/1000) + 's');
        break;
      }
      if (!pageState.needsVerify && !pageState.createdSuccess && waited > 15000) {
        console.log('[auto-create] volcengine: verification done, clicking create again...');
        await execJs(`(() => {
          const texts = ${JSON.stringify(VOLC_CREATE_TEXTS)};
          const els = [...document.querySelectorAll('button')].filter(b => {
            const r = b.getBoundingClientRect(); return r.width > 0 && !b.disabled;
          });
          const btn = els.find(b => texts.some(t => b.textContent.includes(t)));
          if (btn) btn.click();
        })()`).catch(() => {});
        await sleep(3000);
      }
    }
    await removeVolcPrompt();
  }

  await sleep(2000);
  const read = await sendCommand('network-capture-read',
    { workspace: 'okit', ...(tabId ? { tabId } : {}) }, 10000);
  if (!read.ok) throw new Error(read.error || 'network-capture-read failed');
  const entries = read.data || [];
  console.log('[auto-create] volcengine: captured ' + entries.length + ' requests');

  let key = extractKeyFromCaptures(entries, 'volcengine');

  if (!key) {
    const domKey = await execJs(`(() => {
      const text = document.body.innerText || '';
      const akMatch = text.match(/(AKLT[a-zA-Z0-9]{20,})/);
      if (akMatch) return akMatch[1];
      const tokens = text.match(/[a-zA-Z0-9]{30,}/g) || [];
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
      .filter(e => /ak|sk|key|token|secret|iam/i.test(e.url))
      .map(e => e.method + ' ' + e.responseStatus + ' ' + e.url.slice(0, 100))
      .join('\n  ');
    throw new Error('volcengine 未捕获到 key (抓包 ' + entries.length + ' 条。API 相关:\n  ' + (apiUrls || '(无)') + ')');
  }

  await closeAutomationWindow();
  return { value: key, name: tokenName };
}

async function checkVolcPageState() {
  const raw = await execJs(`(() => {
    const modals = [...document.querySelectorAll('.ant-modal-content, [role=dialog]')]
      .filter(m => m.getBoundingClientRect().width > 0);
    const modalText = modals.map(m => m.innerText).join('\n');
    return JSON.stringify({
      needsVerify: /需要额外认证|验证码|短信/i.test(modalText),
      createdSuccess: /创建成功/i.test(modalText),
      modalCount: modals.length,
      modalText: modalText.slice(0, 200),
    });
  })()`).catch(() => '{}');
  try { return JSON.parse(raw); } catch { return {}; }
}

async function injectVolcPrompt(html) {
  await execJs(`(() => {
    const old = document.getElementById('okit-verify-prompt');
    if (old) old.remove();
    const d = document.createElement('div');
    d.id = 'okit-verify-prompt';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#f59e0b;color:#000;padding:16px 24px;text-align:center;font-size:16px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:system-ui,sans-serif;';
    d.innerHTML = ${JSON.stringify(html)};
    document.body.prepend(d);
  })()`).catch(() => {});
}

async function removeVolcPrompt() {
  await execJs(`(() => { const d = document.getElementById('okit-verify-prompt'); if (d) d.remove(); })()`).catch(() => {});
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

// ─── Routes ────────────────────────────────────────────────────────

const SUPPORTED = ['cloudflare', 'volcengine', 'zhipu', 'minimax'];

async function autoCreateKey(req, res) {
  try {
    const { platform, tokenName, parentToken } = req.body;
    if (!platform || !tokenName) return res.status(400).json({ error: 'platform and tokenName are required' });
    if (!SUPPORTED.includes(platform)) return res.status(400).json({ error: `Unknown platform: ${platform}` });

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

    // Browser platforms: atomic-capability orchestration (Phase 1+3).
    // Each platform has its own createXxxKey() that composes generic atoms.
    const ORCHESTRATORS = {
      zhipu: createZhipuKey,
      volcengine: createVolcengineKey,
      minimax: createMinimaxKey,
    };
    const orchestrator = ORCHESTRATORS[platform];
    if (!orchestrator) {
      return res.status(400).json({ success: false, error: `Platform ${platform} not yet supported via orchestration` });
    }

    try {
      const result = await orchestrator({ tokenName });
      if (isAssetData(result.value)) {
        return res.status(500).json({ success: false, error: 'Extracted asset data, not API key.' });
      }
      return res.json({ success: true, value: result.value, name: result.name, platform });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/not connected|disconnected|timed out/i.test(msg)) {
        return res.status(503).json({ success: false, error: msg });
      }
      if (/login|未登录|401|登录/i.test(msg)) {
        return res.status(401).json({ success: false, error: `请在 ${platform} 上登录后再试 (${msg})`, loginRequired: true });
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

module.exports = { autoCreateKey, cdpStatus };
