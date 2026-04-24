const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

async function getLogs(req, res) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      return res.json({ logs: [] });
    }
    const content = fs.readFileSync(HISTORY_FILE, 'utf8');
    const logs = content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean).reverse();

    res.json({ logs });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
}

module.exports = { getLogs };
