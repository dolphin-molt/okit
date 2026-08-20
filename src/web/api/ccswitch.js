// Read-only cc-switch migration scan. Import itself happens through the
// regular provider/vault APIs from the client; this route never writes.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { parseProviderRows, parseLegacyConfig } = require('./ccswitch-parse');

function readSqliteRows(dbPath) {
  return new Promise(resolve => {
    execFile(
      'sqlite3',
      ['-json', dbPath, "SELECT app_type, name, settings_config, is_current FROM providers WHERE app_type IN ('claude','codex')"],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const rows = JSON.parse(stdout || '[]');
          resolve(Array.isArray(rows) ? rows : []);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

async function ccSwitchScanHandler(req, res) {
  try {
    const dir = path.join(os.homedir(), '.cc-switch');
    const dbPath = path.join(dir, 'cc-switch.db');
    const legacyPath = path.join(dir, 'config.json');

    if (fs.existsSync(dbPath)) {
      const rows = await readSqliteRows(dbPath);
      if (rows) {
        return res.json({ found: true, source: 'sqlite', ...parseProviderRows(rows) });
      }
      // DB exists but the sqlite3 CLI is unavailable (common on Windows).
      if (fs.existsSync(legacyPath)) {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
        return res.json({ found: true, source: 'json', ...parseLegacyConfig(legacy) });
      }
      return res.json({ found: false, reason: 'sqlite_cli_missing', providers: [], skipped: [] });
    }

    if (fs.existsSync(legacyPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      return res.json({ found: true, source: 'json', ...parseLegacyConfig(legacy) });
    }

    res.json({ found: false, reason: 'not_installed', providers: [], skipped: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { ccSwitchScanHandler };
