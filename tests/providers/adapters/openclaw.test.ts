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
  OKIT_DIR: '/tmp/test-okit-openclaw',
  REGISTRY_PATH: '/tmp/test-okit-openclaw/registry.json',
  LOGS_DIR: '/tmp/test-okit-openclaw/logs',
  CACHE_DIR: '/tmp/test-okit-openclaw/cache',
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

const { OpenClawAdapter } = await import('../../../src/providers/adapters/openclaw');
const { updateUserConfig } = await import('../../../src/config/user');

const CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

const testProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  type: 'openai' as const,
  baseUrl: 'https://api.deepseek.com',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'deepseek-chat', name: 'DeepSeek V4' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('OpenClawAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new OpenClawAdapter();
    expect(adapter.id).toBe('openclaw');
    expect(adapter.name).toBe('OpenClaw');
  });

  it('supports anthropic/openai/google types', () => {
    const adapter = new OpenClawAdapter();
    expect(adapter.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });
});

describe('OpenClawAdapter.applyConfig', () => {
  it('writes provider into models.providers array (additive)', async () => {
    const adapter = new OpenClawAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(1);
    expect(written.models.providers[0].id).toBe('deepseek');
    expect(written.models.providers[0].apiKey).toBe('sk-test-123');
  });

  it('sets agents.default.model and provider', async () => {
    const adapter = new OpenClawAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.agents.default.model).toBe('deepseek-chat');
    expect(written.agents.default.provider).toBe('deepseek');
  });

  it('preserves existing providers (additive merge)', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      models: { providers: [{ id: 'glm', name: 'GLM', type: 'openai', baseUrl: 'https://glm.com' }] },
    }));

    const adapter = new OpenClawAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers).toHaveLength(2);
  });

  it('maps models to {id, name, capabilities}', async () => {
    const adapter = new OpenClawAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.models.providers[0].models).toEqual([
      { id: 'deepseek-chat', name: 'DeepSeek V4', capabilities: [] },
    ]);
  });

  it('records selection in user.json', async () => {
    const adapter = new OpenClawAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { openclaw: { providerId: 'deepseek', modelId: 'deepseek-chat' } },
      }),
    );
  });
});
