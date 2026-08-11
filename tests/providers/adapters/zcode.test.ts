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
  OKIT_DIR: '/tmp/test-okit-zcode',
  REGISTRY_PATH: '/tmp/test-okit-zcode/registry.json',
  LOGS_DIR: '/tmp/test-okit-zcode/logs',
  CACHE_DIR: '/tmp/test-okit-zcode/cache',
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

const { ZCodeAdapter } = await import('../../../src/providers/adapters/zcode');
const { updateUserConfig } = await import('../../../src/config/user');

const CONFIG_PATH = path.join(os.homedir(), '.zcode', 'config.json');

const testProvider = {
  id: 'volcengine',
  name: '火山引擎',
  type: 'anthropic' as const,
  baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'glm-4.7', name: 'GLM-4.7' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('ZCodeAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new ZCodeAdapter();
    expect(adapter.id).toBe('zcode');
    expect(adapter.name).toBe('ZCode');
  });

  it('supports anthropic/openai/google types', () => {
    const adapter = new ZCodeAdapter();
    expect(adapter.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });
});

describe('ZCodeAdapter.applyConfig', () => {
  it('writes provider into models.providers array (additive)', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(1);
    expect(written.models.providers[0].id).toBe('volcengine');
    expect(written.models.providers[0].baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding');
    expect(written.models.providers[0].apiKey).toBe('sk-test-123');
  });

  it('sets agents.default.model and agents.default.provider', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.agents.default.model).toBe('glm-4.7');
    expect(written.agents.default.provider).toBe('volcengine');
  });

  it('preserves existing providers when switching to a new one (additive merge)', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      models: { providers: [{ id: 'other', name: 'Other', type: 'openai', baseUrl: 'https://other.com' }] },
      agents: { default: { model: 'old', provider: 'other' } },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(2);
    expect(written.models.providers.some((p: any) => p.id === 'other')).toBe(true);
    expect(written.models.providers.some((p: any) => p.id === 'volcengine')).toBe(true);
  });

  it('updates apiKey and models on an existing provider entry (idempotent upsert)', async () => {
    // The adapter upserts by provider.id: when the entry already exists it only
    // refreshes apiKey and the model list — name/type/baseUrl set at creation
    // time are left untouched (the provider identity hasn't changed).
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      models: { providers: [{ id: 'volcengine', name: '火山引擎', type: 'anthropic', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding', apiKey: 'old-key' }] },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(1);
    expect(written.models.providers[0].apiKey).toBe('sk-test-123');
    expect(written.models.providers[0].models).toEqual([
      { id: 'glm-4.7', name: 'GLM-4.7', capabilities: [] },
    ]);
  });

  it('maps models to {id, name, capabilities}', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers[0].models).toEqual([
      { id: 'glm-4.7', name: 'GLM-4.7', capabilities: [] },
    ]);
  });

  it('records selection in user.json', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { zcode: { providerId: 'volcengine', modelId: 'glm-4.7' } },
      }),
    );
  });
});
