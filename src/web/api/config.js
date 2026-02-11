const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_JSON_FILE = path.join(os.homedir(), '.claude.json');

async function readSettings() {
  try {
    const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

async function readClaudeJson() {
  try {
    const content = await fs.readFile(CLAUDE_JSON_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function getConfig(req, res) {
  try {
    const [settings, claudeJson] = await Promise.all([
      readSettings(),
      readClaudeJson(),
    ]);

    res.json({
      settings,
      mcpServers: claudeJson.mcpServers || {},
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
}

async function updateConfig(req, res) {
  try {
    const updates = req.body;

    // Read current settings
    const settings = await readSettings();

    // Apply updates
    const updatedSettings = { ...settings, ...updates };

    // Write back
    await writeSettings(updatedSettings);

    // Return updated config
    const claudeJson = await readClaudeJson();
    res.json({
      settings: updatedSettings,
      mcpServers: claudeJson.mcpServers || {},
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
}

module.exports = { getConfig, updateConfig };
