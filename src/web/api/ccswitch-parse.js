// Pure parsers for cc-switch migration. Kept free of fs/child_process so the
// mapping logic is unit-testable; the route module handles discovery.
//
// cc-switch stores provider configs in two generations:
// - legacy ~/.cc-switch/config.json (v2/v3): { claude: { providers }, codex: { providers } }
// - current ~/.cc-switch/cc-switch.db: providers table, one row per entry,
//   settings_config is a JSON string — a full Claude settings.json for
//   app_type=claude, and { auth, config } (config = TOML text) for codex.

// A migration item the UI can offer for import.
//   source: 'claude' | 'codex'
//   reason (skipped only): 'no_base_url' | 'subscription_only' | 'unparsed'
function mapClaudeSettings(name, settingsConfig, current) {
  const env = (settingsConfig && typeof settingsConfig === 'object' && settingsConfig.env) || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || '';
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || null;
  if (!baseUrl) {
    return { item: null, skip: { source: 'claude', name, reason: 'no_base_url', current } };
  }
  return {
    item: { source: 'claude', name, baseUrl, apiKey, protocol: null, current },
    skip: null,
  };
}

// Extracts every [model_providers.X] entry with its base_url/wire_api. The
// TOML cc-switch writes is machine-generated and flat, so section-scanning is
// sufficient; anything unparsable simply yields no providers.
function parseCodexToml(toml) {
  const out = [];
  if (typeof toml !== 'string' || !toml.includes('[model_providers.')) return out;
  const sectionRe = /\[model_providers\."?([^\]"]+)"?\]([^\[]*)/g;
  let m;
  while ((m = sectionRe.exec(toml)) !== null) {
    const key = m[1];
    const body = m[2];
    const base = body.match(/^base_url\s*=\s*"([^"]+)"/m);
    if (!base) continue;
    const nameMatch = body.match(/^name\s*=\s*"([^"]+)"/m);
    const wire = body.match(/^wire_api\s*=\s*"([^"]+)"/m);
    out.push({
      key,
      name: nameMatch ? nameMatch[1] : key,
      baseUrl: base[1],
      protocol: wire && wire[1] === 'responses' ? 'responses' : 'chat',
    });
  }
  return out;
}

function mapCodexSettings(name, settingsConfig, current) {
  const cfg = settingsConfig && typeof settingsConfig === 'object' ? settingsConfig : {};
  const auth = cfg.auth && typeof cfg.auth === 'object' ? cfg.auth : {};
  const apiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY ? auth.OPENAI_API_KEY : null;
  const providers = parseCodexToml(cfg.config || cfg.configToml || '');
  if (providers.length === 0) {
    const reason = auth.auth_mode === 'chatgpt' || auth.tokens ? 'subscription_only' : 'no_base_url';
    return { items: [], skip: { source: 'codex', name, reason, current } };
  }
  return {
    items: providers.map(p => ({
      source: 'codex',
      name: providers.length === 1 ? name : `${name} · ${p.name}`,
      baseUrl: p.baseUrl,
      apiKey,
      protocol: p.protocol,
      current,
    })),
    skip: null,
  };
}

// rows: [{ app_type, name, settings_config (JSON string), is_current }]
function parseProviderRows(rows) {
  const providers = [];
  const skipped = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let settings = null;
    try {
      settings = typeof row.settings_config === 'string' ? JSON.parse(row.settings_config) : row.settings_config;
    } catch {
      skipped.push({ source: row.app_type, name: row.name, reason: 'unparsed', current: !!row.is_current });
      continue;
    }
    const current = !!row.is_current;
    if (row.app_type === 'claude') {
      const { item, skip } = mapClaudeSettings(row.name, settings, current);
      if (item) providers.push(item);
      if (skip) skipped.push(skip);
    } else if (row.app_type === 'codex') {
      const { items, skip } = mapCodexSettings(row.name, settings, current);
      providers.push(...items);
      if (skip) skipped.push(skip);
    }
    // Other app_types (gemini/hermes/...) are managed natively by OKIT —
    // nothing to migrate there.
  }
  return { providers, skipped };
}

// legacyConfig: parsed JSON of ~/.cc-switch/config.json. Tolerates providers
// stored as an object map or an array, and both settingsConfig spellings.
function parseLegacyConfig(legacyConfig) {
  const rows = [];
  for (const appType of ['claude', 'codex']) {
    const section = legacyConfig && legacyConfig[appType];
    if (!section) continue;
    const raw = Array.isArray(section.providers)
      ? section.providers.map(p => ({ ...p, is_current: p.id === section.current }))
      : Object.entries(section.providers || {}).map(([id, p]) => ({ ...p, id, is_current: id === section.current }));
    for (const p of raw) {
      rows.push({
        app_type: appType,
        name: p.name || p.id,
        settings_config: JSON.stringify(p.settingsConfig || p.settings_config || {}),
        is_current: !!p.is_current,
      });
    }
  }
  return parseProviderRows(rows);
}

module.exports = { parseProviderRows, parseLegacyConfig, parseCodexToml, mapClaudeSettings, mapCodexSettings };
