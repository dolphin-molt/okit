const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGS_DIR = path.join(os.homedir(), '.okit', 'logs');
const HISTORY_FILE = path.join(LOGS_DIR, 'history.jsonl');

/**
 * Append one operation event using the shared log schema.
 * User-facing wording is intentionally resolved by the frontend presentation
 * layer so stored events remain language-neutral and useful for diagnostics.
 */
function appendLog(action, name, success, detail) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const entry = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      name: String(name || ''),
      action: String(action || 'unknown'),
      success: Boolean(success),
      duration: 0,
    };
    if (detail !== undefined && detail !== null && detail !== '') {
      entry.output = typeof detail === 'string' ? detail : JSON.stringify(detail);
    }
    fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never break the user operation that produced the event.
  }
}

module.exports = { appendLog, HISTORY_FILE };
