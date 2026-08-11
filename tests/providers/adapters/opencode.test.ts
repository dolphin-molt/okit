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
  OKIT_DIR: '/tmp/test-okit-opencode',
  REGISTRY_PATH: '/tmp/test-okit-opencode/registry.json',
  LOGS_DIR: '/tmp/test-okit-opencode/logs',
  CACHE_DIR: '/tmp/test-okit-opencode/cache',
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

const { OpenCodeAdapter } = await import('../../../src/providers/adapters/opencode');
const { updateUserConfig } = await import('../../../src/config/user');

const CONFIG_PATH = path.join(os.homedir(), '.opencode', 'config.json');

const openaiProvider = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'gpt-5.5' }],
};

const anthropicProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  type: 'anthropic' as const,
  baseUrl: 'https://api.anthropic.com',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'claude-opus-4-7' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('OpenCodeAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.id).toBe('opencode');
    expect(adapter.name).toBe('OpenCode');
  });

  it('supports anthropic/openai/google types', () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });
});

describe('OpenCodeAdapter.applyConfig', () => {
  it('writes flat config with provider/model/apiKey/baseUrl', async () => {
    const adapter = new OpenCodeAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider).toBe('openai');
    expect(written.model).toBe('gpt-5.5');
    expect(written.apiKey).toBe('sk-test-123');
    expect(written.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('maps provider type via mapProviderType', async () => {
    const adapter = new OpenCodeAdapter();
    await adapter.applyConfig(anthropicProvider, 'claude-opus-4-7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider).toBe('anthropic');
  });

  it('overwrites previous selection (flat, not additive)', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: 'google',
      model: 'gemini-3',
      apiKey: 'old-key',
      baseUrl: 'https://old.com',
    }));

    const adapter = new OpenCodeAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider).toBe('openai');
    expect(written.model).toBe('gpt-5.5');
    expect(written.apiKey).toBe('sk-test-123');
  });

  it('records selection in user.json', async () => {
    const adapter = new OpenCodeAdapter();
    await adapter.applyConfig(openaiProvider, 'gpt-5.5');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { opencode: { providerId: 'openai', modelId: 'gpt-5.5' } },
      }),
    );
  });
});
