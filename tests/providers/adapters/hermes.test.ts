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
  OKIT_DIR: '/tmp/test-okit-hermes',
  REGISTRY_PATH: '/tmp/test-okit-hermes/registry.json',
  LOGS_DIR: '/tmp/test-okit-hermes/logs',
  CACHE_DIR: '/tmp/test-okit-hermes/cache',
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

const { HermesAdapter } = await import('../../../src/providers/adapters/hermes');
const { updateUserConfig } = await import('../../../src/config/user');

const CONFIG_PATH = path.join(os.homedir(), '.hermes', 'config.json');

const testProvider = {
  id: 'glm-coding',
  name: 'GLM Coding Plan',
  type: 'openai' as const,
  baseUrl: 'https://open.bigmodel.cn/api/coding',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'glm-4.7', name: 'GLM-4.7' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('HermesAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new HermesAdapter();
    expect(adapter.id).toBe('hermes');
    expect(adapter.name).toBe('Hermes');
  });

  it('supports anthropic/openai/google types', () => {
    const adapter = new HermesAdapter();
    expect(adapter.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });
});

describe('HermesAdapter.applyConfig', () => {
  it('writes provider into models.providers (additive, same shape as zcode)', async () => {
    const adapter = new HermesAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(1);
    expect(written.models.providers[0].id).toBe('glm-coding');
    expect(written.models.providers[0].apiKey).toBe('sk-test-123');
    expect(written.agents.default.model).toBe('glm-4.7');
    expect(written.agents.default.provider).toBe('glm-coding');
  });

  it('preserves existing providers when adding a new one', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      models: { providers: [{ id: 'old-provider', name: 'Old', type: 'openai', baseUrl: 'https://old.com' }] },
      agents: { default: {} },
    }));

    const adapter = new HermesAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(2);
  });

  it('records selection in user.json', async () => {
    const adapter = new HermesAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { hermes: { providerId: 'glm-coding', modelId: 'glm-4.7' } },
      }),
    );
  });
});
