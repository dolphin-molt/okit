const { VaultStore } = require('../../vault/store');

const store = new VaultStore();

async function listVault(req, res) {
  try {
    const [entries, bindings] = await Promise.all([
      store.list(),
      store.getBindings(),
    ]);

    // Group secrets by key
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.key)) groups.set(e.key, []);
      groups.get(e.key).push(e);
    }

    // Attach bindings to each key
    const secrets = [];
    for (const [key, aliases] of groups) {
      const keyBindings = bindings.filter(b => b.key === key);
      secrets.push({ key, aliases, bindings: keyBindings });
    }

    res.json({ secrets, totalBindings: bindings.length });
  } catch (error) {
    console.error('Error listing vault:', error);
    res.status(500).json({ error: 'Failed to list vault' });
  }
}

async function setVault(req, res) {
  try {
    const { key, alias, value } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    const keyAlias = alias && alias !== 'default' ? `${key}/${alias}` : key;
    await store.set(keyAlias, value);
    res.json({ success: true, key, alias: alias || 'default' });
  } catch (error) {
    console.error('Error setting vault:', error);
    res.status(500).json({ error: 'Failed to set secret' });
  }
}

async function deleteVault(req, res) {
  try {
    const { key, alias } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const keyAlias = alias && alias !== 'default' ? `${key}/${alias}` : key;
    const deleted = await store.delete(keyAlias);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Secret not found' });
    }
  } catch (error) {
    console.error('Error deleting vault:', error);
    res.status(500).json({ error: 'Failed to delete secret' });
  }
}

async function exportVault(req, res) {
  try {
    const secrets = await store.exportAll();
    const bindings = await store.getBindings();
    const data = { secrets, bindings, exportedAt: new Date().toISOString() };
    res.setHeader('Content-Disposition', 'attachment; filename="okit-vault-export.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (error) {
    console.error('Error exporting vault:', error);
    res.status(500).json({ error: 'Failed to export vault' });
  }
}

async function importVault(req, res) {
  try {
    const { secrets } = req.body;
    if (!Array.isArray(secrets) || secrets.length === 0) {
      return res.status(400).json({ error: 'No secrets provided' });
    }
    let imported = 0;
    let skipped = 0;
    for (const s of secrets) {
      if (!s.key) { skipped++; continue; }
      const keyAlias = s.alias && s.alias !== 'default' ? `${s.key}/${s.alias}` : s.key;
      const existing = await store.get(keyAlias);
      if (existing) { skipped++; continue; }
      if (s.value) {
        await store.set(keyAlias, s.value);
        imported++;
      } else {
        skipped++;
      }
    }
    res.json({ success: true, imported, skipped, total: secrets.length });
  } catch (error) {
    console.error('Error importing vault:', error);
    res.status(500).json({ error: 'Failed to import vault' });
  }
}

module.exports = { listVault, setVault, deleteVault, exportVault, importVault };
