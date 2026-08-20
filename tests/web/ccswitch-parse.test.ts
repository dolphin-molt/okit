import { describe, it, expect } from 'vitest';
import { parseProviderRows, parseLegacyConfig, parseCodexToml } from '../../src/web/api/ccswitch-parse.js';

const CLAUDE_THIRD = JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'sk-deep',
  },
});

describe('parseProviderRows (sqlite rows)', () => {
  it('maps a third-party claude provider with its key', () => {
    const { providers, skipped } = parseProviderRows([
      { app_type: 'claude', name: 'DeepSeek Anthropic', settings_config: CLAUDE_THIRD, is_current: 1 },
    ]);
    expect(providers).toEqual([
      { source: 'claude', name: 'DeepSeek Anthropic', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-deep', protocol: null, current: true },
    ]);
    expect(skipped).toEqual([]);
  });

  it('skips official/empty claude entries (no base url)', () => {
    const { providers, skipped } = parseProviderRows([
      { app_type: 'claude', name: 'Claude Official', settings_config: '{"env":{}}', is_current: 0 },
    ]);
    expect(providers).toEqual([]);
    expect(skipped).toEqual([{ source: 'claude', name: 'Claude Official', reason: 'no_base_url', current: false }]);
  });

  it('maps codex model_providers entries with wire_api protocol', () => {
    const settings = JSON.stringify({
      auth: { auth_mode: 'api_key', OPENAI_API_KEY: 'sk-codex' },
      config: [
        'model = "gpt-5"',
        'model_provider = "kimi"',
        '',
        '[model_providers.kimi]',
        'name = "Kimi Coding"',
        'base_url = "https://api.moonshot.cn/codex"',
        'wire_api = "responses"',
        '',
        '[model_providers.deepseek]',
        'name = "DeepSeek Codex"',
        'base_url = "https://api.deepseek.com/codex"',
        'wire_api = "chat"',
      ].join('\n'),
    });
    const { providers } = parseProviderRows([
      { app_type: 'codex', name: '第三方中转', settings_config: settings, is_current: 0 },
    ]);
    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({ baseUrl: 'https://api.moonshot.cn/codex', protocol: 'responses', apiKey: 'sk-codex' });
    expect(providers[1]).toMatchObject({ baseUrl: 'https://api.deepseek.com/codex', protocol: 'chat' });
    // Multiple entries get the display-name suffix.
    expect(providers[0].name).toContain('第三方中转');
    expect(providers[0].name).toContain('Kimi Coding');
  });

  it('skips chatgpt-subscription codex entries', () => {
    const settings = JSON.stringify({
      auth: { auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { id_token: 'x' } },
      config: 'model = "gpt-5"',
    });
    const { providers, skipped } = parseProviderRows([
      { app_type: 'codex', name: 'OpenAI Official', settings_config: settings, is_current: 1 },
    ]);
    expect(providers).toEqual([]);
    expect(skipped).toEqual([{ source: 'codex', name: 'OpenAI Official', reason: 'subscription_only', current: true }]);
  });

  it('ignores non-migratable app types and unparsable rows', () => {
    const { providers, skipped } = parseProviderRows([
      { app_type: 'gemini', name: 'gem', settings_config: '{}', is_current: 0 },
      { app_type: 'claude', name: 'broken', settings_config: '{not json', is_current: 0 },
    ]);
    expect(providers).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ name: 'broken', reason: 'unparsed' });
  });
});

describe('parseCodexToml', () => {
  it('handles quoted provider keys', () => {
    const toml = '[model_providers."packycode"]\nname = "Packy"\nbase_url = "https://x.example/v1"\nwire_api = "responses"';
    const [p] = parseCodexToml(toml);
    expect(p).toEqual({ key: 'packycode', name: 'Packy', baseUrl: 'https://x.example/v1', protocol: 'responses' });
  });

  it('returns empty for toml without model_providers', () => {
    expect(parseCodexToml('model = "gpt-5"')).toEqual([]);
  });
});

describe('parseLegacyConfig (config.json)', () => {
  it('reads v2-style maps and marks the current provider', () => {
    const legacy = {
      claude: {
        current: 'ds',
        providers: {
          ds: { name: 'DeepSeek', settingsConfig: { env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_AUTH_TOKEN: 'sk-1' } } },
          off: { name: 'Official', settingsConfig: { env: {} } },
        },
      },
      codex: {
        current: 'kimi',
        providers: {
          kimi: { name: 'Kimi', settingsConfig: { auth: { OPENAI_API_KEY: 'sk-k' }, config: '[model_providers.kimi]\nbase_url = "https://api.moonshot.cn/codex"' } },
        },
      },
    };
    const { providers, skipped } = parseLegacyConfig(legacy);
    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject({ source: 'claude', name: 'DeepSeek', apiKey: 'sk-1', current: true });
    expect(providers[1]).toMatchObject({ source: 'codex', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/codex', apiKey: 'sk-k', current: true });
    expect(skipped).toEqual([{ source: 'claude', name: 'Official', reason: 'no_base_url', current: false }]);
  });
});
