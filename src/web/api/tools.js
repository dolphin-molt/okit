const { loadRegistry, resolveCmd } = require('../../config/registry');
const { checkStep } = require('../../executor/runner');
const execa = require('execa');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

// Interactive auth sessions
const interactiveSessions = new Map();

// Strip ANSI escape codes
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '').replace(/\x1b\[[0-9;]*[nR]/g, '');
}

const TOOL_CATEGORIES = {
  'Homebrew': 'System',
  'Node.js': 'Development',
  'Git': 'Development',
  'GitHub CLI': 'Development',
  'pnpm': 'Development',
  'bun': 'Development',
  'Python': 'Development',
  'Docker': 'Development',
  'Docker Desktop': 'Containers',
  'pipx': 'Development',
  'uv (uvx)': 'Development',
  'Codex CLI': 'AI Coding',
  'Claude Code': 'AI Coding',
  'Happy Coder': 'AI Coding',
  'Ollama': 'AI Coding',
  'OpenClaw': 'AI Coding',
  'Gemini CLI': 'AI Coding',
  'GitHub Copilot CLI': 'AI Coding',
  'CodeBuddy Code': 'AI Coding',
  '飞书 CLI': 'AI Coding',
  'MMX-CLI': 'AI Coding',
  'yt-dlp': 'Media',
  'curl': 'Utilities',
  'ffmpeg': 'Media',
  'ImageMagick': 'Media',
  'Whisper': 'Media',
  'Mermaid CLI': 'Documents',
  'Pandoc': 'Documents',
  'Playwright': 'Documents',
  'Chromium (Puppeteer)': 'Documents',
  'Jupyter': 'Data',
  'DuckDB': 'Data',
  'ripgrep': 'Utilities',
  'fzf': 'Utilities',
  'tmux': 'Utilities',
  'jq': 'Utilities',
  'httpie': 'Utilities',
  'tree': 'Utilities',
  'bat': 'Utilities',
  'watchman': 'Utilities',
  'iTerm2': 'Terminals',
  'iTerm2 Browser Plugin': 'Terminals',
  'Warp': 'Terminals',
  'Wrangler': 'Cloud',
  'Vercel CLI': 'Cloud',
  'Netlify CLI': 'Cloud',
  'AWS CLI': 'Cloud',
  'Railway CLI': 'Cloud',
  'Supabase CLI': 'Cloud',
  'Firebase CLI': 'Cloud',
  'Google Cloud CLI': 'Cloud',
  'Azure CLI': 'Cloud',
  'Fly.io CLI': 'Cloud',
  'Heroku CLI': 'Cloud',
  'ngrok': 'Network',
  'cloudflared': 'Network',
  'kubectl': 'Containers',
  'Terraform': 'Containers',
  'Redis CLI': 'Database',
  'PostgreSQL': 'Database',
  'xurl': 'Social',
};

function appendLog(name, action, success, duration, output, command) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = { timestamp: new Date().toISOString(), name, action, success, duration };
    if (command) entry.command = command;
    if (output) entry.output = output;
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n');
  } catch {}
}

async function getVersion(step) {
  const cmd = resolveCmd(step.versionCmd);
  if (!cmd) return undefined;
  try {
    const { stdout } = await execa.command(cmd, { shell: true, timeout: 10000 });
    return stdout.trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

// 从 install 命令中提取包管理器和包名
function parsePkgInfo(installCmd) {
  const cmd = typeof installCmd === 'object'
    ? (installCmd.darwin || installCmd.linux || '')
    : (installCmd || '');
  // npm install -g @scope/package or npm install -g package
  const npmMatch = cmd.match(/npm\s+install\s+(?:--force\s+)?-g\s+(@?[\w@./-]+)/);
  if (npmMatch) return { mgr: 'npm', pkg: npmMatch[1] };
  // brew install package / brew install --cask package
  const brewMatch = cmd.match(/brew\s+install\s+(?:--cask\s+)?([\w.-]+)/);
  if (brewMatch) return { mgr: 'brew', pkg: brewMatch[1] };
  // pipx install package
  const pipxMatch = cmd.match(/pipx\s+install\s+(?:--include-deps\s+)?([\w.-]+)/);
  if (pipxMatch) return { mgr: 'pipx', pkg: pipxMatch[1] };
  // gh extension install
  const ghMatch = cmd.match(/gh\s+extension\s+install\s+([\w/-]+)/);
  if (ghMatch) return { mgr: 'gh', pkg: ghMatch[1] };
  return null;
}

async function checkUpgradeAvailable(step) {
  if (!step.upgrade) return false;
  const info = parsePkgInfo(step.install);
  if (!info) return true; // 无法检测的默认显示

  try {
    if (info.mgr === 'npm') {
      // npm outdated exits 1 when outdated, 0 when up-to-date
      await execa.command(`npm outdated -g ${info.pkg}`, { shell: true, timeout: 15000 });
      return false; // exit 0 = no update
    }
    if (info.mgr === 'brew') {
      const { stdout } = await execa.command(`brew outdated --json=v2 2>/dev/null || true`, { shell: true, timeout: 30000 });
      try {
        const data = JSON.parse(stdout);
        const outdated = [...(data.formulae || []), ...(data.casks || [])].map(p => p.name);
        return outdated.includes(info.pkg);
      } catch {
        return false;
      }
    }
    if (info.mgr === 'pipx') {
      const { stdout } = await execa.command(`pipx outdated --json 2>/dev/null || pipx list`, { shell: true, timeout: 15000 });
      return stdout.includes(info.pkg) && /outdated|→|newer/.test(stdout);
    }
    if (info.mgr === 'gh') {
      // gh extensions don't have a simple outdated check
      return true;
    }
  } catch {
    // npm outdated exits 1 when outdated — that means upgrade IS available
    if (info.mgr === 'npm') return true;
    return false;
  }
  return true;
}

async function checkAuth(step) {
  const cmd = resolveCmd(step.authCheck);
  if (!cmd) return { status: 'na', message: null };
  try {
    const { stdout, stderr } = await execa.command(cmd, { shell: true, timeout: 15000 });
    const output = (stdout + '\n' + stderr).trim();
    return { status: 'authorized', message: output.split('\n')[0] };
  } catch (error) {
    const output = ((error.stdout || '') + '\n' + (error.stderr || '')).trim();
    return { status: 'unauthorized', message: output.split('\n')[0] || 'auth check failed' };
  }
}

async function checkSingleTool(step) {
  const installed = await checkStep(step);
  const version = installed ? await getVersion(step) : undefined;
  const auth = installed && step.authCheck ? await checkAuth(step) : { status: 'na', message: null };
  const hasUpgrade = installed && step.upgrade ? await checkUpgradeAvailable(step) : false;
  const hasAuthCheck = !!step.authCheck || !!step.authFix;

  return {
    name: step.name,
    category: step.category || TOOL_CATEGORIES[step.name] || 'Other',
    installed,
    version: version || null,
    authStatus: auth.status !== 'na' ? auth.status : (hasAuthCheck && !installed ? 'not_installed' : 'na'),
    authMessage: auth.message,
    dependencies: step.dependencies || [],
    hasUpgrade,
    hasUninstall: !!step.uninstall,
    hasAuth: !!step.authFix || !!(step.authMethods && step.authMethods.length),
    description: step.description || null,
    detail: step.detail || null,
    homepage: step.homepage || null,
    skill: step.skill || null,
    authMethods: step.authMethods || null,
    type: step.type || 'cli',
    downloadUrl: step.downloadUrl || null,
  };
}

const CACHE_DIR = path.join(os.homedir(), '.okit', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'tools.json');

let toolsCache = null;
let toolsCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let bgRefreshRunning = false;

function loadDiskCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data && data.tools) {
      toolsCache = data;
      toolsCacheTime = data._cacheTime || 0;
      return data;
    }
  } catch {}
  return null;
}

function saveDiskCache(data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...data, _cacheTime: toolsCacheTime }), 'utf-8');
  } catch {}
}

// Load disk cache on startup
loadDiskCache();

async function refreshToolsCache() {
  if (bgRefreshRunning) return;
  bgRefreshRunning = true;
  try {
    const registry = await loadRegistry();
    const steps = registry.steps || [];
    const results = [];
    const BATCH = 5;
    for (let i = 0; i < steps.length; i += BATCH) {
      const batch = steps.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map(step => checkSingleTool(step)));
      results.push(...batchResults);
    }
    const summary = {
      total: results.length,
      installed: results.filter(t => t.installed).length,
      unauthorized: results.filter(t => t.authStatus === 'unauthorized').length,
    };
    const data = { tools: results, summary };
    toolsCache = data;
    toolsCacheTime = Date.now();
    saveDiskCache(data);
  } catch (error) {
    console.error('Background refresh error:', error);
  } finally {
    bgRefreshRunning = false;
  }
}

async function getTools(req, res) {
  try {
    const forceRefresh = req.query.refresh === '1';
    const now = Date.now();
    const cacheAge = now - toolsCacheTime;

    // Fresh cache → return directly
    if (!forceRefresh && toolsCache && cacheAge < CACHE_TTL) {
      return res.json(toolsCache);
    }

    // Stale cache exists → return immediately, refresh in background
    if (!forceRefresh && toolsCache) {
      refreshToolsCache();
      return res.json(toolsCache);
    }

    // No cache at all → must wait for first load
    await refreshToolsCache();
    if (toolsCache) return res.json(toolsCache);

    res.status(500).json({ error: 'Failed to fetch tools' });
  } catch (error) {
    console.error('Error fetching tools:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
}

async function toolAction(req, res) {
  const { name, action } = req.body;
  if (!name || !action) return res.status(400).json({ error: 'name and action are required' });
  if (!['install', 'upgrade', 'uninstall', 'auth'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const registry = await loadRegistry();
  const step = registry.steps.find(s => s.name === name);
  if (!step) return res.status(404).json({ error: `Tool "${name}" not found` });

  let command;
  let isInteractive = false;

  if (action === 'install') command = resolveCmd(step.install);
  else if (action === 'upgrade') command = resolveCmd(step.upgrade);
  else if (action === 'uninstall') command = resolveCmd(step.uninstall);
  else if (action === 'auth') {
    if (step.authMethods && step.authMethods.length > 0 && req.body.authMethod !== undefined) {
      const method = step.authMethods[req.body.authMethod];
      if (!method) return res.status(400).json({ error: 'Invalid auth method' });
      if (method.manual) return res.status(400).json({ error: 'Manual auth method — no command to run' });
      if (method.interactive) {
        isInteractive = true;
        return handleInteractiveAuth(req, res, step, method, name);
      }
      command = method.command;
      if (req.body.token && command) {
        command = command.replace(/\{token\}/g, req.body.token.replace(/'/g, "'\\''"));
      }
    } else {
      command = resolveCmd(step.authFix);
    }
  }
  if (!command) return res.status(400).json({ error: `${name} has no ${action} command` });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');

  if (action === 'auth') {
    send({ type: 'output', text: '⚠ 授权命令可能需要在浏览器中完成，请在输出中查找链接。\n\n' });
  }

  const startTime = Date.now();
  const child = execa.command(command, { shell: true, timeout: 300000 });
  let outputLines = [];

  function send(obj) {
    try { res.write(JSON.stringify(obj) + '\n'); } catch {}
  }

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    if (text.trim()) {
      send({ type: 'output', text });
      outputLines.push(text.trim());
    }
  });
  child.stderr.on('data', chunk => {
    const text = chunk.toString();
    if (text.trim()) {
      send({ type: 'output', text });
      outputLines.push(text.trim());
    }
  });

  req.on('close', () => { try { child.kill(); } catch {} });

  child.then(() => {
    const duration = Date.now() - startTime;
    send({ type: 'result', success: true, duration });
    const fullOutput = outputLines.join('\n');
    appendLog(name, action, true, duration, fullOutput || undefined, command);
    toolsCache = null; toolsCacheTime = 0;
    res.end();
  }).catch(err => {
    const duration = Date.now() - startTime;
    toolsCache = null; toolsCacheTime = 0;
    const output = ((err.stdout || '') + '\n' + (err.stderr || '')).trim();
    send({ type: 'result', success: false, output: output || err.message, duration });
    appendLog(name, action, false, duration, output || err.message, command);
    res.end();
  });
}

async function openApp(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    await execa('open', ['-a', name]);
    appendLog(name, 'open', true, 0);
    res.json({ success: true });
  } catch (error) {
    appendLog(name, 'open', false, 0, error.message);
    res.json({ success: false, message: error.message });
  }
}

module.exports = { getTools, toolAction, submitAuthCode, openApp };

function handleInteractiveAuth(req, res, step, method, name) {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const codeFile = path.join(os.tmpdir(), `okit-code-${sessionId}.txt`);
  const scriptFile = path.join(os.tmpdir(), `okit-auth-${sessionId}.expect`);
  fs.writeFileSync(codeFile, '');

  const loginCmd = method.loginCommand || '';
  const autoEnterPattern = method.autoEnter || 'Press Enter';
  const waitForPattern = method.waitFor || 'verification code';

  // Write expect script to file to avoid shell quoting issues
  const expectScript = [
    'set timeout 300',
    'log_user 1',
    `spawn ${loginCmd}`,
    `expect -re {${autoEnterPattern.replace(/[{}[\]]/g, '.')}}`,
    'send "\\r"',
    `expect -re {${waitForPattern.replace(/[{}[\]]/g, '.')}}`,
    'flush stdout',
    `while {[file size "${codeFile}"] == 0} { after 500 }`,
    'set fp [open "' + codeFile + '" r]',
    'set code [string trim [read $fp]]',
    'close $fp',
    'send "$code\\r"',
    'expect eof',
  ].join('\n');

  fs.writeFileSync(scriptFile, expectScript);

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');

  function send(obj) {
    try { res.write(JSON.stringify(obj) + '\n'); } catch {}
  }

  send({ type: 'interactive', sessionId });
  send({ type: 'output', text: `正在启动浏览器登录，请等待...\n\n` });

  const startTime = Date.now();
  let outputLines = [];
  let codeSent = false;
  const waitForText = method.waitFor || 'verification code';

  const child = execa.command(`expect ${scriptFile}`, { shell: true, timeout: 300000 });
  interactiveSessions.set(sessionId, { codeFile, scriptFile, child });

  function handleOutput(text) {
    const clean = stripAnsi(text);
    if (clean.trim()) {
      send({ type: 'output', text: clean });
      outputLines.push(clean.trim());
    }
    if (!codeSent && clean.includes(waitForText)) {
      codeSent = true;
      console.log(`[interactive-auth] ${name}: detected "${waitForText}", sending waitingForCode event, sessionId=${sessionId}`);
      send({ type: 'waitingForCode' });
    }
  }

  child.stdout.on('data', chunk => handleOutput(chunk.toString()));
  child.stderr.on('data', chunk => handleOutput(chunk.toString()));

  req.on('close', () => {
    try { child.kill(); } catch {}
    cleanupSession(sessionId);
  });

  child.then(() => {
    const duration = Date.now() - startTime;
    send({ type: 'result', success: true, duration });
    appendLog(name, 'auth', true, duration, outputLines.join('\n') || undefined, loginCmd);
    toolsCache = null; toolsCacheTime = 0;
    res.end();
    cleanupSession(sessionId);
  }).catch(err => {
    const duration = Date.now() - startTime;
    toolsCache = null; toolsCacheTime = 0;
    const output = stripAnsi(((err.stdout || '') + '\n' + (err.stderr || '')).trim());
    send({ type: 'result', success: false, output: output || err.message, duration });
    appendLog(name, 'auth', false, duration, output || err.message, loginCmd);
    res.end();
    cleanupSession(sessionId);
  });
}

function cleanupSession(sessionId) {
  const session = interactiveSessions.get(sessionId);
  if (session) {
    try { fs.unlinkSync(session.codeFile); } catch {}
    try { if (session.scriptFile) fs.unlinkSync(session.scriptFile); } catch {}
    interactiveSessions.delete(sessionId);
  }
}

function submitAuthCode(req, res) {
  const { sessionId, code } = req.body;
  if (!sessionId || !code) return res.status(400).json({ error: 'sessionId and code required' });

  const session = interactiveSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  try {
    fs.writeFileSync(session.codeFile, code.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
