// ═══════════════════════════════════════════
// OKIT — Dashboard Controller
// ═══════════════════════════════════════════

// State
let currentPage = 'dashboard';
let configData = null;
let refreshTimer = null;

// ─── Toast ───
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  // Trigger reflow for re-animation
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

// ─── Router ───
function navigate(page) {
  if (currentPage === page && document.querySelector(`#page-${page}.active`)) return;
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-links li').forEach(li => {
    li.classList.remove('active');
  });
  document.querySelector(`[data-page="${page}"]`)?.closest('li').classList.add('active');

  // Update pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) {
    target.classList.add('active');
    // Re-trigger stagger animations
    target.querySelectorAll('.stat-card, .stat-pill, .section, .config-section').forEach(el => {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    });
  }

  // Load data
  if (page === 'dashboard') {
    loadStats();
  } else if (page === 'config') {
    loadConfig();
  }
}

// ─── Stats ───
async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();

    // Animate value updates
    animateValue('totalTokens', formatNumber(data.totalTokens));
    animateValue('totalCost', '$' + data.totalCost.toFixed(2));
    animateValue('sessionCount', data.sessionCount);
    animateValue('activeTime', formatDuration(data.activeTime));
    animateValue('linesOfCode', formatNumber(data.linesOfCode));
    animateValue('commitCount', data.commitCount);
    animateValue('prCount', data.prCount);

    // Update sessions table
    const tbody = document.getElementById('sessionsTable');
    if (data.recentSessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="loading"><span>暂无会话记录</span></td></tr>';
    } else {
      tbody.innerHTML = data.recentSessions.map((session, i) => `
        <tr style="animation: rowSlide 0.3s ease ${i * 0.03}s both">
          <td>${escapeHtml(session.project)}</td>
          <td><span class="model-tag">${escapeHtml(session.model || '-')}</span></td>
          <td>${formatNumber(session.tokens)}</td>
          <td>${formatDate(session.timestamp)}</td>
        </tr>
      `).join('');
    }

    setStatus('connected');
  } catch (error) {
    console.error('Failed to load stats:', error);
    setStatus('error');
  }
}

function refreshStats() {
  const btn = document.querySelector('.btn-refresh');
  if (btn) {
    btn.style.pointerEvents = 'none';
    setTimeout(() => { btn.style.pointerEvents = ''; }, 1000);
  }
  loadStats();
}

// ─── Config ───
async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    configData = data;

    const settings = data.settings || {};

    document.getElementById('configModel').value = settings.model || '';
    document.getElementById('configTeammateMode').value = settings.teammateMode || 'auto';
    document.getElementById('configLanguage').value = settings.language || 'english';
    document.getElementById('configOutputStyle').value = settings.outputStyle || 'Concise';
    document.getElementById('configShowTurnDuration').checked = settings.showTurnDuration || false;
    document.getElementById('configSpinnerTipsEnabled').checked = settings.spinnerTipsEnabled !== false;

    setStatus('connected');
  } catch (error) {
    console.error('Failed to load config:', error);
    setStatus('error');
  }
}

async function saveConfig() {
  const btn = document.querySelector('.btn-save');
  const originalText = btn.querySelector('span').textContent;
  btn.querySelector('span').textContent = '保存中...';
  btn.style.pointerEvents = 'none';

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: document.getElementById('configModel').value || undefined,
        teammateMode: document.getElementById('configTeammateMode').value,
        language: document.getElementById('configLanguage').value,
        outputStyle: document.getElementById('configOutputStyle').value,
        showTurnDuration: document.getElementById('configShowTurnDuration').checked,
        spinnerTipsEnabled: document.getElementById('configSpinnerTipsEnabled').checked,
      }),
    });

    if (response.ok) {
      showToast('配置已保存', 'success');
    } else {
      showToast('保存失败', 'error');
    }
  } catch (error) {
    console.error('Failed to save config:', error);
    showToast('保存失败', 'error');
  } finally {
    btn.querySelector('span').textContent = originalText;
    btn.style.pointerEvents = '';
  }
}

// ─── Status ───
function setStatus(status) {
  const statusEl = document.getElementById('status');
  statusEl.className = 'status ' + status;
  const textEl = statusEl.querySelector('.status-text');

  if (status === 'connected') {
    textEl.textContent = '已连接';
  } else if (status === 'error') {
    textEl.textContent = '连接失败';
  } else {
    textEl.textContent = '连接中...';
  }
}

// ─── Helpers ───
function formatNumber(num) {
  if (num === undefined || num === null) return '—';
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatDuration(seconds) {
  if (seconds === undefined || seconds === null) return '—';
  if (seconds < 60) {
    return seconds + '秒';
  } else if (seconds < 3600) {
    return Math.floor(seconds / 60) + '分钟';
  } else if (seconds < 86400) {
    return Math.floor(seconds / 3600) + '小时';
  }
  return Math.floor(seconds / 86400) + '天';
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) {
    return '刚刚';
  } else if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前';
  } else if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前';
  } else if (diff < 604800000) {
    return Math.floor(diff / 86400000) + '天前';
  }

  return date.toLocaleDateString('zh-CN');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function animateValue(id, newValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.textContent;
  if (current === String(newValue)) return;
  el.style.transition = 'none';
  el.style.opacity = '0.4';
  el.style.transform = 'translateY(4px)';
  void el.offsetWidth;
  el.textContent = newValue;
  el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
}

// ─── Inject dynamic keyframes ───
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rowSlide {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .model-tag {
      display: inline-block;
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(167, 139, 250, 0.08);
      color: rgba(167, 139, 250, 0.8);
      font-family: 'DM Sans', monospace;
      letter-spacing: 0.2px;
    }
  `;
  document.head.appendChild(style);
})();

// ─── Event Listeners ───
document.addEventListener('DOMContentLoaded', () => {
  // Handle nav clicks
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });

  // Handle hash changes
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(2) || 'dashboard';
    navigate(hash);
  });

  // Initial navigation
  const initialPage = window.location.hash.slice(2) || 'dashboard';
  navigate(initialPage);

  // Auto-refresh stats every 30 seconds
  refreshTimer = setInterval(() => {
    if (currentPage === 'dashboard') {
      loadStats();
    }
  }, 30000);
});
