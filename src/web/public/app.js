// OKIT — Tool List + Vault + Logs Controller

let toolsData = [];
let currentCategory = 'all';
let searchTerm = '';
let statusFilter = 'all';
let selectedTools = new Set();
let refreshTimer = null;
let currentTab = 'tools';

// ─── Tab switching (sidebar nav) ───
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById(`tab-${tab}`).style.display = '';

  clearInterval(refreshTimer);
  if (tab === 'tools') {
    loadTools();
    refreshTimer = setInterval(loadTools, 30000);
  }
  if (tab === 'vault') loadVault();
  if (tab === 'auth') loadAuth();
  if (tab === 'logs') loadLogs();
}

// ─── Theme ───
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? '' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('okit-theme', next);
}

(function initTheme() {
  const saved = localStorage.getItem('okit-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ─── Toast ───
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setStatus(status) {
  const el = document.getElementById('status');
  el.className = 'status ' + status;
  el.querySelector('.status-text').textContent =
    status === 'connected' ? '已连接' : status === 'error' ? '连接失败' : '连接中';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════
// PROGRESS (streaming output)
// ═══════════════════════════════════════

function showProgress(name, action) {
  const modal = document.getElementById('progressModal');
  const labels = { install: '安装', upgrade: '升级', uninstall: '卸载' };
  document.getElementById('progressTitle').textContent = `正在${labels[action] || action} ${name}...`;
  document.getElementById('progressOutput').textContent = '';
  document.getElementById('progressFooter').innerHTML =
    '<div class="progress-spinner"><span></span><span></span><span></span></div>';
  modal.style.display = '';
}

function linkify(text) {
  return escapeHtml(text).replace(
    /https?:\/\/[^\s)\]'"<>]+/g,
    '<a href="$&" target="_blank" rel="noopener" class="progress-link">$&</a>'
  );
}

let authUrlOpened = false;
let authUrls = [];
let authUrlTimer = null;

function appendProgressLine(text) {
  const el = document.getElementById('progressOutput');
  el.innerHTML += linkify(text);
  el.scrollTop = el.scrollHeight;
  if (lastAction && lastAction.action === 'auth') {
    const matches = text.match(/https?:\/\/[^\s)\]'"<>]+/g);
    if (matches) {
      authUrls.push(...matches);
      clearTimeout(authUrlTimer);
      authUrlTimer = setTimeout(() => {
        if (!authUrlOpened && authUrls.length > 0) {
          window.open(authUrls[authUrls.length - 1], '_blank');
          authUrlOpened = true;
        }
      }, 2000);
    }
  }
}

function showCodeInput() {
  const el = document.getElementById('progressOutput');
  el.innerHTML += '<div id="codeInputArea" class="code-input-area"><div class="code-input-label">请在浏览器中完成登录，然后将验证码粘贴到下方：</div><div class="code-input-wrap"><input type="text" id="authCodeInput" class="auth-token-input" placeholder="粘贴验证码..." autocomplete="off"><button class="auth-btn-confirm code-submit-btn" onclick="submitCode()">提交</button></div></div>';
  el.scrollTop = el.scrollHeight;
  setTimeout(() => { const inp = document.getElementById('authCodeInput'); if (inp) inp.focus(); }, 100);
}

function hideCodeInput() {
  // Will be replaced by showProgressResult
}

async function submitCode() {
  const input = document.getElementById('authCodeInput');
  if (!input || !input.value.trim()) {
    input && input.classList.add('auth-token-input--error');
    return;
  }
  const code = input.value.trim();
  const footer = document.getElementById('progressFooter');
  footer.innerHTML = '<div class="progress-spinner"><span></span><span></span><span></span></div><span style="margin-left:8px;font-size:12px">验证中...</span>';

  try {
    const res = await fetch('/api/tools/auth-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: interactiveSessionId, code }),
    });
    if (!res.ok) {
      appendProgressLine('提交验证码失败\n');
    }
  } catch {
    appendProgressLine('提交验证码失败\n');
  }
}

function showProgressResult(event) {
  const footer = document.getElementById('progressFooter');
  const title = document.getElementById('progressTitle');
  if (event.success) {
    footer.innerHTML = '<span class="progress-result progress-result--ok">完成</span>';
    title.textContent = title.textContent.replace('正在', '').replace('...', ' — 完成');
  } else {
    footer.innerHTML =
      '<span class="progress-result progress-result--fail">失败</span>' +
      '<button class="progress-retry" onclick="retryLastAction()">重试</button>';
    title.textContent = title.textContent.replace('正在', '').replace('...', ' — 失败');
  }
}

function closeProgress() {
  document.getElementById('progressModal').style.display = 'none';
}

let lastAction = null;

function retryLastAction() {
  if (!lastAction) return;
  executeAction(lastAction.name, lastAction.action);
}

let interactiveSessionId = null;

function executeAction(name, action, authMethod, token) {
  lastAction = { name, action };
  authUrlOpened = false;
  authUrls = [];
  interactiveSessionId = null;
  clearTimeout(authUrlTimer);
  return new Promise(resolve => {
    showProgress(name, action);
    const body = { name, action };
    if (authMethod !== undefined) body.authMethod = authMethod;
    if (token !== undefined) body.token = token;
    fetch('/api/tools/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async res => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let success = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'output') appendProgressLine(event.text);
            if (event.type === 'interactive') interactiveSessionId = event.sessionId;
            if (event.type === 'waitingForCode') showCodeInput();
            if (event.type === 'result') {
              success = event.success;
              hideCodeInput();
              showProgressResult(event);
            }
          } catch {}
        }
      }
      resolve(success);
    }).catch(() => {
      appendProgressLine('连接失败\n');
      showProgressResult({ success: false });
      resolve(false);
    });
  });
}

// ═══════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════

async function loadTools(forceRefresh) {
  try {
    const url = forceRefresh ? '/api/tools?refresh=1' : '/api/tools';
    const res = await fetch(url);
    const data = await res.json();
    toolsData = data.tools || [];
    renderSummary(data.summary);
    populateCategories(toolsData);
    renderToolList(filterTools());
    setStatus('connected');
  } catch (err) {
    console.error('Failed to load tools:', err);
    setStatus('error');
    document.getElementById('toolList').innerHTML = '<div class="loading">加载失败</div>';
  }
}

function refreshTools() {
  const btn = document.querySelector('#tab-tools .btn-refresh');
  if (btn) btn.style.pointerEvents = 'none';
  setTimeout(() => { if (btn) btn.style.pointerEvents = ''; }, 1000);
  loadTools(true);
}

function renderSummary(summary) {
  if (!summary) return;
  document.getElementById('summaryInstalled').textContent = summary.installed;
  document.getElementById('summaryTotal').textContent = summary.total;
  const authWrap = document.getElementById('summaryAuthWrap');
  if (summary.unauthorized > 0) {
    authWrap.style.display = '';
    document.getElementById('summaryAuth').textContent = summary.unauthorized;
  } else {
    authWrap.style.display = 'none';
  }
}

function populateCategories(tools) {
  const select = document.getElementById('categoryFilter');
  const current = select.value;
  const cats = [...new Set(tools.map(t => t.category))].sort();
  select.innerHTML = '<option value="all">全部分类</option>';
  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  select.value = cats.includes(current) || current === 'all' ? current : 'all';
  if (!cats.includes(current) && current !== 'all') currentCategory = 'all';
}

function filterTools() {
  return toolsData.filter(t => {
    const matchCat = currentCategory === 'all' || t.category === currentCategory;
    const matchSearch = !searchTerm || t.name.toLowerCase().includes(searchTerm.toLowerCase());
    let matchStatus = true;
    if (statusFilter === 'installed') matchStatus = t.installed;
    else if (statusFilter === 'missing') matchStatus = !t.installed;
    else if (statusFilter === 'unauthorized') matchStatus = t.authStatus === 'unauthorized';
    return matchCat && matchSearch && matchStatus;
  });
}

function handleSearch(value) {
  searchTerm = value.trim();
  renderToolList(filterTools());
}

function handleFilter(value) {
  currentCategory = value;
  renderToolList(filterTools());
}

function handleStatusFilter(value) {
  statusFilter = value;
  document.querySelectorAll('.status-filter').forEach(b => b.classList.toggle('active', b.dataset.status === value));
  renderToolList(filterTools());
}

const CATEGORY_COLORS = {
  'System':        { bg: '#fef9ef', shadow: '#d97706', tape: '#fde68a' },
  'Development':   { bg: '#eff6ff', shadow: '#2563eb', tape: '#bfdbfe' },
  'AI Coding':     { bg: '#f0fdf4', shadow: '#16a34a', tape: '#bbf7d0' },
  'Media':         { bg: '#fdf4ff', shadow: '#9333ea', tape: '#e9d5ff' },
  'Documents':     { bg: '#fff7ed', shadow: '#ea580c', tape: '#fed7aa' },
  'Data':          { bg: '#f0fdfa', shadow: '#0d9488', tape: '#99f6e4' },
  'Utilities':     { bg: '#fef2f2', shadow: '#dc2626', tape: '#fecaca' },
  'Terminals':     { bg: '#fefce8', shadow: '#ca8a04', tape: '#fef08a' },
  'Cloud':         { bg: '#eef2ff', shadow: '#4f46e5', tape: '#c7d2fe' },
  'Network':       { bg: '#f0f9ff', shadow: '#0284c7', tape: '#bae6fd' },
  'Containers':    { bg: '#fffbeb', shadow: '#b45309', tape: '#fde68a' },
  'Database':      { bg: '#ecfdf5', shadow: '#059669', tape: '#a7f3d0' },
  'Social':        { bg: '#fdf2f8', shadow: '#db2777', tape: '#fbcfe8' },
};
const DEFAULT_CARD_COLOR = { bg: '#f9fafb', shadow: '#6b7280', tape: '#d1d5db' };

function getColorByCategory(category) {
  return CATEGORY_COLORS[category] || DEFAULT_CARD_COLOR;
}



function renderToolList(tools) {
  const container = document.getElementById('toolList');
  if (tools.length === 0) {
    container.innerHTML = '<div class="loading">没有匹配的工具</div>';
    return;
  }
  const sorted = [...tools].sort((a, b) => {
    if (a.installed !== b.installed) return b.installed - a.installed;
    return a.name.localeCompare(b.name);
  });
  container.innerHTML = sorted.map((tool, i) => {
    const c = getColorByCategory(tool.category);
    const rotate = ((i * 37) % 7 - 3) * 0.15;
    const offsetX = ((i * 53) % 5 - 2) * 1.5;
    const sel = selectedTools.has(tool.name);

    const actions = [];
    if (!tool.installed) {
      actions.push(`<button class="btn-action btn-action--install" data-tool="${escapeHtml(tool.name)}" data-action="install" onclick="toolAction(this)">安装</button>`);
    }
    if (tool.installed && tool.hasUpgrade) {
      actions.push(`<button class="btn-action btn-action--upgrade" data-tool="${escapeHtml(tool.name)}" data-action="upgrade" onclick="toolAction(this)">升级</button>`);
    }
    if (tool.installed && tool.hasUninstall) {
      actions.push(`<button class="btn-action btn-action--uninstall" data-tool="${escapeHtml(tool.name)}" data-action="uninstall" onclick="toolAction(this)">卸载</button>`);
    }
    if (tool.authStatus === 'unauthorized' && tool.hasAuth) {
      actions.push(`<button class="btn-action btn-action--auth" data-tool="${escapeHtml(tool.name)}" data-action="auth" onclick="toolAction(this)">授权</button>`);
    }

    return `
      <div class="tool-card${sel ? ' tool-card--selected' : ''}" data-tool-name="${escapeHtml(tool.name)}"
           style="--card-bg: ${c.bg}; --card-shadow: ${c.shadow}; --card-tape: ${c.tape}; --card-rotate: ${rotate}deg; --card-x: ${offsetX}px">
        <div class="tape-strip"></div>
        <div class="tool-card-body">
          <div class="tool-card-row">
            <div class="tool-card-name-wrap">
              <button class="tool-select${sel ? ' selected' : ''}" data-tool="${escapeHtml(tool.name)}" onclick="toggleSelect(this)" title="选择">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="2"/>
                  <path d="M4.5 7.5L6 9l3.5-3.5"/>
                </svg>
              </button>
              <span class="tool-name" onclick="showToolDetail('${escapeHtml(tool.name)}')">${escapeHtml(tool.name)}</span>
            </div>
            <span class="tool-category">${escapeHtml(tool.category)}</span>
          </div>
          <div class="tool-card-meta">
            <span class="tool-status ${tool.installed ? 'installed' : 'missing'}">
              ${tool.installed ? '● 已安装' : '○ 未安装'}
            </span>
            ${tool.version ? `<span class="tool-version">${escapeHtml(tool.version)}</span>` : ''}
            ${tool.authStatus === 'authorized' ? '<span class="tool-auth ok">✓ 授权</span>' : ''}
            ${tool.authStatus === 'unauthorized' ? '<span class="tool-auth fail">✗ 未授权</span>' : ''}
            ${tool.authMessage ? `<span class="tool-auth-detail" title="${escapeHtml(tool.authMessage)}">${escapeHtml(tool.authMessage)}</span>` : ''}
            ${tool.dependencies.length > 0 ? `<span class="tool-deps">依赖: ${tool.dependencies.map(d => escapeHtml(d)).join(', ')}</span>` : ''}
          </div>
          ${actions.length > 0 ? `<div class="tool-card-actions">${actions.join('')}</div>` : ''}
          <div class="tool-detail" data-tool="${escapeHtml(tool.name)}"></div>
        </div>
      </div>`;
  }).join('');
}

// ─── Selection & Batch ───

function toggleSelect(btn) {
  const name = btn.dataset.tool;
  const card = btn.closest('.tool-card');
  if (selectedTools.has(name)) {
    selectedTools.delete(name);
    btn.classList.remove('selected');
    card.classList.remove('tool-card--selected');
  } else {
    selectedTools.add(name);
    btn.classList.add('selected');
    card.classList.add('tool-card--selected');
  }
  updateBatchBar();
}

function selectAll() {
  const filtered = filterTools();
  const allSelected = filtered.every(t => selectedTools.has(t.name));
  filtered.forEach(t => {
    if (allSelected) selectedTools.delete(t.name);
    else selectedTools.add(t.name);
  });
  renderToolList(filterTools());
  updateBatchBar();
}

function clearSelection() {
  selectedTools.clear();
  document.querySelectorAll('.tool-select').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.tool-card--selected').forEach(c => c.classList.remove('tool-card--selected'));
  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  if (selectedTools.size > 0) {
    bar.style.display = '';
    document.getElementById('batchCount').textContent = selectedTools.size;
  } else {
    bar.style.display = 'none';
  }
}

async function batchAction(action) {
  const names = [...selectedTools];
  if (names.length === 0) return;
  const bar = document.getElementById('batchBar');
  bar.querySelectorAll('.btn-batch').forEach(b => b.disabled = true);
  const labels = { install: '安装', upgrade: '升级', uninstall: '卸载' };
  let ok = 0, fail = 0;
  for (let i = 0; i < names.length; i++) {
    document.getElementById('progressTitle').textContent = `${labels[action]} ${names[i]} (${i + 1}/${names.length})...`;
    const success = await executeAction(names[i], action);
    success ? ok++ : fail++;
  }
  showToast(fail === 0 ? `${ok} 个工具${labels[action]}成功` : `${ok} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
  closeProgress();
  clearSelection();
  loadTools();
  bar.querySelectorAll('.btn-batch').forEach(b => b.disabled = false);
}

// ─── Tool Detail Page ───

function renderMd(md) {
  let html = escapeHtml(md);
  // code blocks: ```...```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="md-pre"><code class="md-code${lang ? ' lang-' + lang : ''}">${code.trim()}</code></pre>`);
  // inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  // headings: ## ...
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  // bold: **...**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // unordered list items: - ...
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  // wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');
  // paragraphs (lines not already tagged)
  html = html.replace(/^(?!<[huplo]|<li|<strong|<code|<pre)(.+)$/gm, '<p class="md-p">$1</p>');
  // clean up extra blank lines
  html = html.replace(/\n{2,}/g, '\n');
  return html;
}

function showToolDetail(name) {
  const tool = toolsData.find(t => t.name === name);
  if (!tool) return;

  const c = getColorByCategory(tool.category);
  const container = document.getElementById('tab-tools');
  container.dataset.prevHtml = container.innerHTML;
  container.innerHTML = '';

  const actions = [];
  if (!tool.installed) actions.push(`<button class="btn-action btn-action--install" data-tool="${escapeHtml(tool.name)}" data-action="install" onclick="toolAction(this)">安装</button>`);
  if (tool.installed && tool.hasUpgrade) actions.push(`<button class="btn-action btn-action--upgrade" data-tool="${escapeHtml(tool.name)}" data-action="upgrade" onclick="toolAction(this)">升级</button>`);
  if (tool.installed && tool.hasUninstall) actions.push(`<button class="btn-action btn-action--uninstall" data-tool="${escapeHtml(tool.name)}" data-action="uninstall" onclick="toolAction(this)">卸载</button>`);
  if (tool.authStatus === 'unauthorized') actions.push(`<button class="btn-action btn-action--auth" data-tool="${escapeHtml(tool.name)}" data-action="auth" onclick="toolAction(this)">授权</button>`);

  let infoRows = '';
  infoRows += `<div class="detail-row"><span class="detail-row-label">分类</span><span class="detail-row-value">${escapeHtml(tool.category)}</span></div>`;
  infoRows += `<div class="detail-row"><span class="detail-row-label">安装状态</span><span class="detail-row-value ${tool.installed ? 'detail-ok' : 'detail-fail'}">${tool.installed ? '已安装' : '未安装'}</span></div>`;
  if (tool.version) infoRows += `<div class="detail-row"><span class="detail-row-label">版本</span><span class="detail-row-value">${escapeHtml(tool.version)}</span></div>`;
  if (tool.authStatus === 'authorized') infoRows += `<div class="detail-row"><span class="detail-row-label">授权</span><span class="detail-row-value detail-ok">已授权</span></div>`;
  if (tool.authStatus === 'unauthorized') infoRows += `<div class="detail-row"><span class="detail-row-label">授权</span><span class="detail-row-value detail-fail">未授权</span></div>`;
  if (tool.authMessage) infoRows += `<div class="detail-row"><span class="detail-row-label">授权信息</span><span class="detail-row-value detail-mono">${escapeHtml(tool.authMessage)}</span></div>`;
  if (tool.dependencies.length > 0) infoRows += `<div class="detail-row"><span class="detail-row-label">依赖</span><span class="detail-row-value">${tool.dependencies.map(d => escapeHtml(d)).join(', ')}</span></div>`;
  if (tool.homepage) infoRows += `<div class="detail-row"><span class="detail-row-label">官网</span><span class="detail-row-value"><a href="${escapeHtml(tool.homepage)}" target="_blank" rel="noopener" class="detail-link">${escapeHtml(tool.homepage)}</a></span></div>`;

  const el = document.createElement('div');
  el.className = 'tool-detail-page';
  el.innerHTML = `
    <button class="detail-back" onclick="closeToolDetail()">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 2L4 7l5 5"/></svg>
      返回工具列表
    </button>
    <div class="detail-hero" style="--card-bg: ${c.bg}; --card-shadow: ${c.shadow}; --card-tape: ${c.tape}">
      <div class="tape-strip"></div>
      <div class="detail-hero-body">
        <h2 class="detail-hero-name">${escapeHtml(tool.name)}</h2>
        <span class="detail-hero-cat">${escapeHtml(tool.category)}</span>
        ${actions.length ? `<div class="detail-hero-actions">${actions.join('')}</div>` : ''}
      </div>
    </div>
    ${tool.description ? `<p class="detail-page-desc">${escapeHtml(tool.description)}</p>` : ''}
    <div class="detail-info-card">
      <h3 class="detail-info-title">工具信息</h3>
      ${infoRows}
    </div>
    ${tool.skill ? `
    <div class="detail-info-card detail-skill-card">
      <h3 class="detail-info-title">AI Skill</h3>
      <p class="detail-skill-text">${escapeHtml(tool.skill)}</p>
    </div>` : ''}
    ${tool.detail ? `
    <div class="detail-info-card detail-md-card">
      <div class="detail-md">${renderMd(tool.detail)}</div>
    </div>` : ''}`;

  container.appendChild(el);
}

function closeToolDetail() {
  const container = document.getElementById('tab-tools');
  if (container.dataset.prevHtml) {
    container.innerHTML = container.dataset.prevHtml;
    delete container.dataset.prevHtml;
  }
}

// ─── Single Tool Action ───

async function toolAction(btn) {
  const name = btn.dataset.tool;
  const action = btn.dataset.action;
  const card = btn.closest('.tool-card, .auth-card');
  const allBtns = card ? card.querySelectorAll('.btn-action') : [btn];
  allBtns.forEach(b => b.disabled = true);

  // authActions with authMethods → show auth dialog
  if (action === 'auth') {
    const tool = toolsData.find(t => t.name === name);
    if (tool && tool.authMethods && tool.authMethods.length > 0) {
      allBtns.forEach(b => b.disabled = false);
      showAuthDialog(name, tool.authMethods);
      return;
    }
  }

  const success = await executeAction(name, action);
  if (success) {
    const labels = { install: '安装', upgrade: '升级', uninstall: '卸载', auth: '授权' };
    showToast(`${name} ${labels[action]}成功`);
    closeToolDetail();
    closeProgress();
    setTimeout(() => { loadTools(true); loadAuth(); }, 1500);
  } else {
    showToast(`${name} ${action} 失败`, 'error');
    allBtns.forEach(b => b.disabled = false);
  }
}

// ─── Auth Dialog ───

let authDialogTool = null;
let authDialogMethods = null;
let authSelectedMethod = 0;

function showAuthDialog(name, methods) {
  authDialogTool = name;
  authDialogMethods = methods;
  authSelectedMethod = methods.findIndex(m => m.recommended) || 0;
  if (authSelectedMethod < 0) authSelectedMethod = 0;

  document.getElementById('authDialogTitle').textContent = `授权 ${name}`;
  renderAuthMethods();
  document.getElementById('authDialog').style.display = '';
}

function closeAuthDialog() {
  document.getElementById('authDialog').style.display = 'none';
  authDialogTool = null;
  authDialogMethods = null;
}

function renderAuthMethods() {
  const body = document.getElementById('authDialogBody');
  const method = authDialogMethods[authSelectedMethod];
  const needsToken = method.command && method.command.includes('{token}');
  const isManual = method.manual;
  const single = authDialogMethods.length === 1;

  body.innerHTML = `
    ${!single ? `<div class="auth-methods">
      ${authDialogMethods.map((m, i) => `
        <div class="auth-method-card ${i === authSelectedMethod ? 'auth-method-card--active' : ''}" onclick="selectAuthMethod(${i})">
          <div class="auth-method-radio"><span></span></div>
          <div class="auth-method-info">
            <div class="auth-method-name">${escapeHtml(m.name)}${m.recommended ? ' <span class="auth-badge">推荐</span>' : ''}</div>
            ${m.description ? `<div class="auth-method-desc">${escapeHtml(m.description)}</div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>` : ''}
    ${isManual ? `
    <div class="auth-manual-section">
      ${method.steps && method.steps.length ? `
      <ol class="auth-steps">
        ${method.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ol>` : ''}
    </div>
    ` : ''}
    ${!isManual && needsToken ? `
    <div class="auth-token-section">
      <div class="auth-token-header">
        <label class="auth-token-label">Access Token</label>
        ${method.tokenUrl ? `<a class="auth-token-link" href="${escapeHtml(method.tokenUrl)}" target="_blank" rel="noopener">获取 Token →</a>` : ''}
      </div>
      ${method.tokenHint ? `<div class="auth-token-hint">${escapeHtml(method.tokenHint)}</div>` : ''}
      <input type="password" id="authTokenInput" class="auth-token-input" placeholder="粘贴你的 Token..." autocomplete="off">
    </div>
    ` : ''}
  `;

  // update footer
  const footer = document.getElementById('authDialogFooter');
  if (isManual) {
    footer.innerHTML = `
      <button class="auth-btn-cancel" onclick="closeAuthDialog()">取消</button>
      <button class="auth-btn-confirm" style="background:#22c55e;border-color:#16a34a" onclick="manualAuthDone()">我已完成授权</button>
    `;
  } else if (method.interactive) {
    footer.innerHTML = `
      <button class="auth-btn-cancel" onclick="closeAuthDialog()">取消</button>
      <button class="auth-btn-confirm" onclick="submitAuth()">开始授权</button>
    `;
  } else {
    footer.innerHTML = `
      <button class="auth-btn-cancel" onclick="closeAuthDialog()">取消</button>
      <button class="auth-btn-confirm" onclick="submitAuth()">${needsToken ? '确认授权' : '开始授权'}</button>
    `;
  }
}

function selectAuthMethod(index) {
  authSelectedMethod = index;
  renderAuthMethods();
}

function manualAuthDone() {
  const toolName = authDialogTool;
  closeAuthDialog();
  showToast(`${toolName} 正在验证授权状态...`);
  setTimeout(() => { loadTools(true); loadAuth(); }, 1000);
}

async function submitAuth() {
  const method = authDialogMethods[authSelectedMethod];
  const needsToken = method.command && method.command.includes('{token}');
  let token = null;

  if (needsToken) {
    const input = document.getElementById('authTokenInput');
    token = input ? input.value.trim() : '';
    if (!token) {
      input && input.classList.add('auth-token-input--error');
      showToast('请输入 Token', 'error');
      return;
    }
  }

  const toolName = authDialogTool;
  const methodIndex = authSelectedMethod;
  closeAuthDialog();
  const success = await executeAction(toolName, 'auth', methodIndex, token);
  if (success) {
    showToast(`${toolName} 授权成功`);
    closeProgress();
    closeToolDetail();
    setTimeout(() => { loadTools(true); loadAuth(); }, 1500);
  } else {
    showToast(`${toolName} 授权失败`, 'error');
  }
}

// ═══════════════════════════════════════
// VAULT
// ═══════════════════════════════════════

let vaultEditKey = null;
let vaultEditAlias = null;

async function loadVault() {
  try {
    const res = await fetch('/api/vault');
    const data = await res.json();
    renderVault(data.secrets);
    setStatus('connected');
  } catch (err) {
    console.error('Failed to load vault:', err);
    setStatus('error');
    document.getElementById('vaultList').innerHTML = '<div class="loading">加载失败</div>';
  }
}

function renderVault(secrets) {
  const container = document.getElementById('vaultList');
  if (!secrets || secrets.length === 0) {
    container.innerHTML = '<div class="loading">暂无密钥，点击「添加密钥」开始</div>';
    return;
  }
  const VAULT_COLORS = [
    { bg: '#fef9ef', shadow: '#b45309' },
    { bg: '#f0fdf4', shadow: '#15803d' },
    { bg: '#eff6ff', shadow: '#1d4ed8' },
    { bg: '#fdf4ff', shadow: '#7e22ce' },
    { bg: '#fff7ed', shadow: '#c2410c' },
    { bg: '#f0fdfa', shadow: '#0f766e' },
  ];

  container.innerHTML = secrets.map((secret, i) => {
    const c = VAULT_COLORS[i % VAULT_COLORS.length];
    const rotate = ((i * 41) % 7 - 3) * 0.2;
    const hasMultiple = secret.aliases.length > 1 || secret.aliases[0].alias !== 'default';
    return `
      <div class="vault-card"
           style="--card-bg: ${c.bg}; --card-shadow: ${c.shadow}; --card-rotate: ${rotate}deg">
        <div class="vault-card-body">
          <div class="vault-card-row">
            <span class="vault-key">${escapeHtml(secret.key)}</span>
            <div class="vault-card-actions">
              <button class="btn-icon" title="编辑" onclick="editVault('${escapeHtml(secret.key)}', '${escapeHtml(secret.aliases[0].alias)}')">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                  <path d="M8 2l4 4L5 13H1V9z"/>
                </svg>
              </button>
              <button class="btn-icon btn-icon--danger" title="删除" onclick="deleteVault('${escapeHtml(secret.key)}', '${escapeHtml(secret.aliases[0].alias)}')">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                  <path d="M2 4h10M5 4V2h4v2M4 4v8a1 1 0 001 1h4a1 1 0 001-1V4"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="vault-aliases">
            ${secret.aliases.map(a => `
              <div class="vault-alias-row">
                ${hasMultiple ? `<span class="vault-alias-name">/${escapeHtml(a.alias)}</span>` : ''}
                <span class="vault-masked">${escapeHtml(a.masked)}</span>
                <span class="vault-date">${formatDate(a.updatedAt)}</span>
              </div>
            `).join('')}
          </div>
          ${secret.bindings && secret.bindings.length > 0 ? `
            <div class="vault-bindings">
              ${secret.bindings.map(b => `
                <span class="vault-binding-tag">${escapeHtml(b.envName || b.key)} → ${escapeHtml(b.file)}</span>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>`;
  }).join('');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN');
}

function showVaultForm(key, alias) {
  vaultEditKey = key || null;
  vaultEditAlias = alias || null;
  document.getElementById('vaultFormTitle').textContent = key ? '编辑密钥' : '添加密钥';
  document.getElementById('vaultKey').value = key || '';
  document.getElementById('vaultKey').disabled = !!key;
  document.getElementById('vaultAlias').value = alias || '';
  document.getElementById('vaultAlias').disabled = !!key;
  document.getElementById('vaultValue').value = '';
  document.getElementById('vaultValue').type = 'password';
  document.getElementById('vaultForm').style.display = '';
  if (!key) document.getElementById('vaultKey').focus();
  else document.getElementById('vaultValue').focus();
}

function hideVaultForm() {
  document.getElementById('vaultForm').style.display = 'none';
  vaultEditKey = null;
  vaultEditAlias = null;
}

function editVault(key, alias) {
  showVaultForm(key, alias);
}

function toggleValueVis() {
  const input = document.getElementById('vaultValue');
  const btn = input.nextElementSibling;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '隐藏';
  } else {
    input.type = 'password';
    btn.textContent = '显示';
  }
}

async function saveVault() {
  const key = document.getElementById('vaultKey').value.trim();
  const alias = document.getElementById('vaultAlias').value.trim() || 'default';
  const value = document.getElementById('vaultValue').value;

  if (!key || !value) {
    showToast('Key 和 Value 不能为空', 'error');
    return;
  }

  try {
    const res = await fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, alias, value }),
    });
    const data = await res.json();
    if (data.success) {
      showToast(vaultEditKey ? '密钥已更新' : '密钥已添加');
      hideVaultForm();
      loadVault();
    } else {
      showToast(data.error || '保存失败', 'error');
    }
  } catch (err) {
    showToast('保存失败', 'error');
  }
}

async function deleteVault(key, alias) {
  if (!confirm(`确定删除 ${key}${alias !== 'default' ? '/' + alias : ''} ？`)) return;
  try {
    const res = await fetch('/api/vault', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, alias }),
    });
    const data = await res.json();
    if (data.success) {
      showToast('已删除');
      loadVault();
    } else {
      showToast(data.error || '删除失败', 'error');
    }
  } catch (err) {
    showToast('删除失败', 'error');
  }
}

function exportVault() {
  window.open('/api/vault/export', '_blank');
  showToast('导出文件已下载');
}

function triggerImportVault() {
  document.getElementById('vaultImportFile').click();
}

async function handleImportVault(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.secrets || !Array.isArray(data.secrets)) {
      return showToast('无效的导出文件', 'error');
    }
    const res = await fetch('/api/vault/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (result.success) {
      showToast(`导入完成：${result.imported} 个新增，${result.skipped} 个跳过`);
      loadVault();
    } else {
      showToast(result.error || '导入失败', 'error');
    }
  } catch (err) {
    showToast('文件解析失败', 'error');
  }
}

// ═══════════════════════════════════════
// LOGS
// ═══════════════════════════════════════

async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    renderLogs(data.logs);
    setStatus('connected');
  } catch (err) {
    console.error('Failed to load logs:', err);
    setStatus('error');
    document.getElementById('logList').innerHTML = '<div class="loading">加载失败</div>';
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logList');
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="loading">暂无操作记录</div>';
    return;
  }

  const LOG_COLORS = [
    { bg: '#fef9ef', shadow: '#b45309' },
    { bg: '#f0fdf4', shadow: '#15803d' },
    { bg: '#eff6ff', shadow: '#1d4ed8' },
    { bg: '#fff7ed', shadow: '#c2410c' },
    { bg: '#fef2f2', shadow: '#b91c1c' },
    { bg: '#f0fdfa', shadow: '#0f766e' },
  ];

  container.innerHTML = logs.map((log, i) => {
    const c = LOG_COLORS[i % LOG_COLORS.length];
    const rotate = ((i * 43) % 7 - 3) * 0.15;
    const actionLabels = { install: '安装', upgrade: '升级', uninstall: '卸载', auth: '授权' };
    const d = new Date(log.timestamp);
    const timeStr = d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dur = log.duration ? (log.duration < 1000 ? log.duration + 'ms' : Math.round(log.duration / 1000) + 's') : '';
    const logId = `log-${i}`;
    const outputText = log.output || log.message || '';
    const hasDetail = outputText || log.command;

    return `
      <div class="log-card" style="--card-bg: ${c.bg}; --card-shadow: ${c.shadow}; --card-rotate: ${rotate}deg">
        <div class="log-card-body">
          <div class="log-card-row">
            <span class="log-status ${log.success ? 'log-ok' : 'log-fail'}">${log.success ? '✓' : '✗'}</span>
            <span class="log-name">${escapeHtml(log.name)}</span>
            <span class="log-action">${actionLabels[log.action] || log.action}</span>
            <span class="log-time">${timeStr}</span>
            ${dur ? `<span class="log-duration">${dur}</span>` : ''}
            ${hasDetail ? `<span class="log-toggle" onclick="toggleLogDetail('${logId}')">详情</span>` : ''}
          </div>
          <div id="${logId}" class="log-detail" style="display:none">
            ${log.command ? `<div class="log-detail-cmd"><span class="log-detail-label">命令</span><code>${escapeHtml(log.command)}</code></div>` : ''}
            ${outputText ? `<div class="log-detail-output"><span class="log-detail-label">输出</span><pre>${escapeHtml(outputText)}</pre></div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleLogDetail(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ═══════════════════════════════════════
// AUTH LIST
// ═══════════════════════════════════════

async function loadAuth() {
  try {
    const res = await fetch('/api/tools?refresh=1');
    const data = await res.json();
    const authTools = (data.tools || []).filter(t => t.authStatus !== 'na' || t.hasAuth);
    renderAuthSummary(authTools);
    renderAuthList(authTools);
    setStatus('connected');
  } catch (err) {
    console.error('Failed to load auth:', err);
    setStatus('error');
    document.getElementById('authList').innerHTML = '<div class="loading">加载失败</div>';
  }
}

function renderAuthSummary(tools) {
  const ok = tools.filter(t => t.authStatus === 'authorized').length;
  const fail = tools.filter(t => t.authStatus === 'unauthorized').length;
  const notInst = tools.filter(t => t.authStatus === 'not_installed').length;
  const container = document.getElementById('authSummary');
  container.innerHTML = `
    <div class="summary-card" style="--card-bg: #dcfce7; --card-rotate: -0.8deg; --card-shadow: #16a34a">
      <span class="summary-num">${ok}</span>
      <span class="summary-label">已授权</span>
    </div>
    <div class="summary-card" style="--card-bg: #fee2e2; --card-rotate: 0.5deg; --card-shadow: #ef4444">
      <span class="summary-num">${fail}</span>
      <span class="summary-label">未授权</span>
    </div>
    <div class="summary-card" style="--card-bg: #fef9ef; --card-rotate: -0.3deg; --card-shadow: #d97706">
      <span class="summary-num">${notInst}</span>
      <span class="summary-label">未安装</span>
    </div>
    <div class="summary-card" style="--card-bg: #f3f4f6; --card-rotate: 0.2deg; --card-shadow: #9ca3af">
      <span class="summary-num">${tools.length}</span>
      <span class="summary-label">总计</span>
    </div>`;
}

function renderAuthList(tools) {
  const container = document.getElementById('authList');
  if (!tools.length) {
    container.innerHTML = '<div class="loading">暂无需要授权的工具</div>';
    return;
  }
  const statusOrder = { unauthorized: 0, not_installed: 1, authorized: 2 };
  const sorted = [...tools].sort((a, b) => {
    const oa = statusOrder[a.authStatus] ?? 3;
    const ob = statusOrder[b.authStatus] ?? 3;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
  container.innerHTML = sorted.map((tool, i) => {
    const isOk = tool.authStatus === 'authorized';
    const isNotInst = tool.authStatus === 'not_installed';
    const c = isOk
      ? { bg: '#f0fdf4', shadow: '#16a34a', tape: '#bbf7d0' }
      : isNotInst
      ? { bg: '#fef9ef', shadow: '#d97706', tape: '#fde68a' }
      : { bg: '#fef2f2', shadow: '#dc2626', tape: '#fecaca' };
    const rotate = ((i * 41) % 7 - 3) * 0.12;
    const icon = isOk ? '✓' : isNotInst ? '○' : '✗';
    const iconClass = isOk ? 'auth-ok' : isNotInst ? 'auth-muted' : 'auth-fail';
    const badge = isOk ? '已授权' : isNotInst ? '未安装' : '未授权';
    const badgeClass = isOk ? 'auth-badge--ok' : isNotInst ? 'auth-badge--muted' : 'auth-badge--fail';
    return `
      <div class="auth-card" style="--card-bg: ${c.bg}; --card-shadow: ${c.shadow}; --card-tape: ${c.tape}; --card-rotate: ${rotate}deg">
        <div class="tape-strip"></div>
        <div class="auth-card-body">
          <div class="auth-card-main">
            <span class="auth-status-icon ${iconClass}">${icon}</span>
            <div class="auth-card-info">
              <span class="auth-card-name">${escapeHtml(tool.name)}</span>
              <span class="auth-card-cat">${escapeHtml(tool.category)}</span>
            </div>
            <span class="auth-badge ${badgeClass}">${badge}</span>
          </div>
          ${tool.authMessage ? `<div class="auth-card-detail">${escapeHtml(tool.authMessage)}</div>` : ''}
          <div class="auth-card-actions">
            ${tool.authStatus === 'not_installed' ? `<button class="btn-action btn-action--install" data-tool="${escapeHtml(tool.name)}" data-action="install" onclick="toolAction(this)">安装</button>` : ''}
            ${tool.authStatus === 'unauthorized' ? `<button class="btn-action btn-action--auth" data-tool="${escapeHtml(tool.name)}" data-action="auth" onclick="toolAction(this)">授权</button>` : ''}
            ${tool.authStatus === 'authorized' ? `<button class="btn-action btn-action--reauth" data-tool="${escapeHtml(tool.name)}" data-action="auth" onclick="toolAction(this)">重新授权</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  switchTab('tools');
});
