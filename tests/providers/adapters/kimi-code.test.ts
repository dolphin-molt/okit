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
    rename: vi.fn(async function(oldPath: string, newPath: string) { const c = files.get(oldPath); if (c !== undefined) files.set(newPath, c); }),
    ensureDir: vi.fn(async function() {}),
  };
});

vi.mock('fs-extra', () => ({ default: mocks }));

// kimi-code calls /bin/launchctl setenv on macOS — mock it so tests don't
// actually shell out (codex.test.ts currently gets away without this because
// its assertions don't care, but kimi-code writes a per-provider env key).
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: any) => cb?.(null)),
}));

vi.mock('../../../src/config/registry', () => ({
  OKIT_DIR: '/tmp/test-okit-kimi-code',
  REGISTRY_PATH: '/tmp/test-okit-kimi-code/registry.json',
  LOGS_DIR: '/tmp/test-okit-kimi-code/logs',
  CACHE_DIR: '/tmp/test-okit-kimi-code/cache',
}));

vi.mock('../../../src/config/user', () => ({
  loadUserConfig: vi.fn(async function() { return {}; }),
  updateUserConfig: vi.fn(async function(patch: any) { return patch; }),
}));

vi.mock('../../../src/vault/store', () => ({
  VaultStore: vi.fn().mockImplementation(function(this: any) {
    this.get = vi.fn(async function(key: string) { return key === 'TEST_API_KEY' ? 'sk-test-123' : undefined; });
  }),
}));

const { KimiCodeAdapter } = await import('../../../src/providers/adapters/kimi-code');
const { updateUserConfig } = await import('../../../src/config/user');

const CONFIG_PATH = path.join(os.homedir(), '.kimi-code', 'config.toml');
const ENV_PATH = path.join(os.homedir(), '.kimi-code', '.env');

// A third-party OpenAI-compatible provider (the common case for kimi-code).
const customProvider = {
  id: 'custom-openai',
  name: 'Custom OpenAI',
  type: 'openai' as const,
  baseUrl: 'https://custom.api.com/v1',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'my-model' }],
};

// The official Kimi/Moonshot provider — should resolve to providerId "kimi".
const moonshotProvider = {
  id: 'moonshot',
  name: 'Moonshot',
  type: 'openai' as const,
  baseUrl: 'https://api.moonshot.ai/v1',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'moonshot-v1-128k' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('KimiCodeAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new KimiCodeAdapter();
    expect(adapter.id).toBe('kimi-code');
    expect(adapter.name).toBe('Kimi Code');
  });

  it('supports openai type only', () => {
    const adapter = new KimiCodeAdapter();
    expect(adapter.supportedTypes).toEqual(['openai']);
  });
});

describe('KimiCodeAdapter.applyConfig', () => {
  it('writes model and model_provider to config.toml', async () => {
    const adapter = new KimiCodeAdapter();
    await adapter.applyConfig(customProvider, 'my-model');

    const toml = mocks.files.get(CONFIG_PATH)!;
    expect(toml).toContain('model = "my-model"');
    expect(toml).toContain('model_provider = "okit-custom-openai"');
  });

  it('writes [model_providers.X] table with base_url/env_key/wire_api for custom providers', async () => {
    const adapter = new KimiCodeAdapter();
    await adapter.applyConfig(customProvider, 'my-model');

    const toml = mocks.files.get(CONFIG_PATH)!;
    expect(toml).toContain('[model_providers.okit-custom-openai]');
    expect(toml).toContain('base_url = "https://custom.api.com/v1"');
    expect(toml).toContain('env_key = "OKIT_KIMI_CODE_CUSTOM_OPENAI_API_KEY"');
    expect(toml).toContain('wire_api = "chat"');
  });

  it('writes .env with the per-provider env key', async () => {
    const adapter = new KimiCodeAdapter();
    await adapter.applyConfig(customProvider, 'my-model');

    const env = mocks.files.get(ENV_PATH)!;
    expect(env).toMatch(/OKIT_KIMI_CODE_CUSTOM_OPENAI_API_KEY=['"]?sk-test-123['"]?/);
  });

  it('resolves official moonshot to providerId "kimi" and uses MOONSHOT_API_KEY', async () => {
    const adapter = new KimiCodeAdapter();
    await adapter.applyConfig(moonshotProvider, 'moonshot-v1-128k');

    const toml = mocks.files.get(CONFIG_PATH)!;
    expect(toml).toContain('model_provider = "kimi"');
    // No [model_providers.kimi] table is emitted for the official provider
    expect(toml).not.toContain('[model_providers.kimi]');

    const env = mocks.files.get(ENV_PATH)!;
    expect(env).toMatch(/MOONSHOT_API_KEY=['"]?sk-test-123['"]?/);
  });

  it('chooses wire_api = "responses" when endpoint protocol is responses', async () => {
    const responsesProvider = {
      ...customProvider,
      endpoints: [{ type: 'openai' as const, baseUrl: 'https://custom.api.com/v1', protocol: 'responses' as const }],
    };
    const adapter = new KimiCodeAdapter();
    await adapter.applyConfig(responsesProvider, 'my-model');

    const toml = mocks.files.get(CONFIG_PATH)!;
    expect(toml).toContain('wire_api = "responses"');
  });

  it('records selection in user.json under "kimi-code" key', async () => {
    const adapter = new KimiCodeAdapter();
    await adapter.applyConfig(customProvider, 'my-model');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { 'kimi-code': { providerId: 'custom-openai', modelId: 'my-model' } },
      }),
    );
  });
});
