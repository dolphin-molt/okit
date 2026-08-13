const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

const SECRET_PREFIX_PATTERN = /\b(?:npm_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]+)\b/gi;
const SECRET_FIELD_PATTERN = /((?:api[_-]?key|access[_-]?token|auth(?:entication)?[_-]?token|secret(?:[_-]?key)?|password|authorization|_authToken)\s*[:=]\s*['"]?)([^'"\s,;&]{8,})/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

function redactText(value) {
  return String(value)
    .replace(AUTH_HEADER_PATTERN, '$1 [REDACTED]')
    .replace(SECRET_FIELD_PATTERN, '$1[REDACTED]')
    .replace(SECRET_PREFIX_PATTERN, '[REDACTED]');
}

function redactLog(log) {
  const safe = { ...log };
  for (const field of ['command', 'output', 'message', 'target']) {
    if (typeof safe[field] === 'string') safe[field] = redactText(safe[field]);
  }
  return safe;
}

async function getLogs(req, res) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      return res.json({ logs: [] });
    }
    const content = fs.readFileSync(HISTORY_FILE, 'utf8');
    const logs = content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean).reverse().map(redactLog);

    res.json({ logs });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
}

module.exports = { getLogs, redactLog };
