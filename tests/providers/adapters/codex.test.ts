import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    pathExists: vi.fn(async function(p: string) { return files.has(p); }),
    readFile: vi.fn(async function(p: string) { return files.get(p) ?? ''; }),
    writeFile: vi.fn(async function(p: string, c: string) { files.set(p, c); }),
    ensureDir: vi.fn(async function() {}),
  };
});

vi.mock('fs-extra', () => ({ default: mocks }));

vi.mock('../../../src/config/registry', () => ({
  OKIT_DIR: '/tmp/test-okit-codex',
  REGISTRY_PATH: '/tmp/test-okit-codex/registry.json',
  LOGS_DIR: '/tmp/test-okit-codex/logs',
  CACHE_DIR: '/tmp/test-okit-codex/cache',
}));

vi.mock('../../../src/config/user', () => ({
  loadUserConfig: vi.fn(async function() { return {}; }),
  updateUserConfig: vi.fn(async function(patch: any) { return patch; }),
}));

vi.mock('../../../src/vault/store', () => ({
  VaultStore: Object.assign(vi.fn().mockImplementation(function(this: any) {
    this.get = vi.fn(async function(key: string) { return key === 'CODEX_API_KEY' ? 'sk-codex-456' : undefined; });
    this.resolve = vi.fn(async function(key: string, alias?: string) {
      if (key === 'CODEX_API_KEY' && alias === 'team') return 'sk-codex-team';
      if (key === 'CODEX_API_KEY') return 'sk-codex-456';
      return undefined;
    });
  }), {
    parseKeyAlias(input: string) {
      const slashIdx = input.indexOf('/');
      if (slashIdx === -1) return { key: input, alias: 'default' };
      return { key: input.slice(0, slashIdx), alias: input.slice(slashIdx + 1) };
    },
  }),
}));

vi.mock('../../../src/providers/auth', () => ({
  checkCodexOAuth: vi.fn(async function() { return false; }),
}));

const { CodexAdapter } = await import('../../../src/providers/adapters/codex');
const { updateUserConfig } = await import('../../../src/config/user');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG = path.join(CODEX_DIR, 'config.toml');
const CODEX_ENV = path.join(CODEX_DIR, '.env');

const openaiProvider = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  vaultKey: 'CODEX_API_KEY',
  authMode: 'both' as const,
  models: [{ id: 'gpt-5.5' }],
};

const customProvider = {
  id: 'custom-openai',
  name: 'Custom OpenAI',
  type: 'openai' as const,
  baseUrl: 'https://custom.api.com/v1',
  vaultKey: 'CODEX_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'my-model' }],
};

const customAliasProvider = {
  ...openaiProvider,
  vaultKey: 'CODEX_API_KEY/team',
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('CodexAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new CodexAdapter();
    expect(adapter.id).toBe('codex');
    expect(adapter.name).toBe('Codex');
  });

  it('supports openai type only', () => {
    const adapter = new CodexAdapter();
    expect(adapter.supportedTypes).toEqual(['openai']);
  });
});

describe('CodexAdapter.applyConfig', () => {
  it('writes model to config.toml', async () => {
    const adapter = new CodexAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    const toml = mocks.files.get(CODEX_CONFIG)!;
    expect(toml).toContain('model = "gpt-5.5"');
  });

  it('writes .env with OPENAI_API_KEY', async () => {
    const adapter = new CodexAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    const env = mocks.files.get(CODEX_ENV)!;
    // The TS adapter writes `export KEY='value'` (shell-quoted). Match loosely so
    // the test is robust to the shell-quoting format.
    expect(env).toMatch(/OPENAI_API_KEY=['"]?sk-codex-456['"]?/);
  });

  it('resolves explicit vault aliases when writing .env', async () => {
    const adapter = new CodexAdapter();
    await adapter.applyConfig(customAliasProvider, 'gpt-5.5');

    const env = mocks.files.get(CODEX_ENV)!;
    expect(env).toMatch(/OPENAI_API_KEY=['"]?sk-codex-team['"]?/);
  });

  it('writes base_url under [model_providers.X] for non-official endpoints (not top-level api_base)', async () => {
    // The TS adapter correctly uses a [model_providers.X] table with base_url
    // and removes the legacy top-level api_base key (which was a Codex bug).
    const adapter = new CodexAdapter();
    await adapter.applyConfig(customProvider, 'my-model');

    const toml = mocks.files.get(CODEX_CONFIG)!;
    expect(toml).toContain('[model_providers.okit-custom-openai]');
    expect(toml).toContain('base_url = "https://custom.api.com/v1"');
    expect(toml).not.toContain('api_base');
    // wire_api defaults to "chat" when the endpoint has no protocol specified
    expect(toml).toContain('wire_api = "chat"');
  });

  it('removes api_base for official OpenAI', async () => {
    mocks.files.set(CODEX_CONFIG, 'model = "old"\napi_base = "https://old.com"\n');

    const adapter = new CodexAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    const toml = mocks.files.get(CODEX_CONFIG)!;
    expect(toml).toContain('model = "gpt-5.5"');
    expect(toml).not.toContain('api_base');
  });

  it('updates existing model field in toml', async () => {
    mocks.files.set(CODEX_CONFIG, 'model = "old-model"\nsome_other = "value"\n');

    const adapter = new CodexAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    const toml = mocks.files.get(CODEX_CONFIG)!;
    expect(toml).toContain('model = "gpt-5.5"');
    expect(toml).toContain('some_other = "value"');
  });

  it('updates user config with codex selection', async () => {
    const adapter = new CodexAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { codex: { providerId: 'openai', modelId: 'gpt-5.5' } },
      }),
    );
  });
});
