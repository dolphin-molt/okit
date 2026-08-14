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

vi.mock('../../../src/config/registry', () => ({
  OKIT_DIR: '/tmp/test-okit-workbuddy',
  REGISTRY_PATH: '/tmp/test-okit-workbuddy/registry.json',
  LOGS_DIR: '/tmp/test-okit-workbuddy/logs',
  CACHE_DIR: '/tmp/test-okit-workbuddy/cache',
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

const { WorkBuddyAdapter } = await import('../../../src/providers/adapters/workbuddy');
const { updateUserConfig } = await import('../../../src/config/user');

const MODELS_PATH = path.join(os.homedir(), '.workbuddy', 'models.json');

const testProvider = {
  id: 'glm-coding',
  name: 'GLM Coding Plan',
  type: 'openai' as const,
  baseUrl: 'https://open.bigmodel.cn/api/coding',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'glm-4.7', name: 'GLM-4.7' }, { id: 'glm-4.6', name: 'GLM-4.6' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('WorkBuddyAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new WorkBuddyAdapter();
    expect(adapter.id).toBe('workbuddy');
    expect(adapter.name).toBe('WorkBuddy');
  });

  it('supports anthropic/openai types', () => {
    const adapter = new WorkBuddyAdapter();
    expect(adapter.supportedTypes).toEqual(['anthropic', 'openai']);
  });
});

describe('WorkBuddyAdapter.applyConfig', () => {
  it('writes model entry with vendor and chat completions URL', async () => {
    const adapter = new WorkBuddyAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(MODELS_PATH)!);
    expect(written.models).toHaveLength(1);
    expect(written.models[0].id).toBe('glm-4.7');
    expect(written.models[0].name).toBe('GLM-4.7');
    expect(written.models[0].vendor).toBe('GLM Coding Plan');
    expect(written.models[0].url).toBe('https://open.bigmodel.cn/api/coding/chat/completions');
    expect(written.models[0].apiKey).toBe('sk-test-123');
  });

  it('adds the model id to availableModels', async () => {
    const adapter = new WorkBuddyAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(MODELS_PATH)!);
    expect(written.availableModels).toContain('glm-4.7');
  });

  it('does NOT append baseUrl /chat/completions if it already ends with it', async () => {
    const provider = { ...testProvider, baseUrl: 'https://open.bigmodel.cn/api/coding/chat/completions' };
    const adapter = new WorkBuddyAdapter();
    await adapter.applyConfig(provider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(MODELS_PATH)!);
    expect(written.models[0].url).toBe('https://open.bigmodel.cn/api/coding/chat/completions');
  });

  it('updates existing model entry in place (idempotent upsert)', async () => {
    mocks.files.set(MODELS_PATH, JSON.stringify({
      models: [{ id: 'glm-4.7', name: 'Old', vendor: 'Old', url: 'https://old.com/chat/completions' }],
      availableModels: ['glm-4.7'],
    }));

    const adapter = new WorkBuddyAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(MODELS_PATH)!);
    expect(written.models).toHaveLength(1);
    expect(written.models[0].vendor).toBe('GLM Coding Plan');
  });

  it('records selection in user.json', async () => {
    const adapter = new WorkBuddyAdapter();
    await adapter.applyConfig(testProvider, 'glm-4.7');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { workbuddy: { providerId: 'glm-coding', modelId: 'glm-4.7' } },
      }),
    );
  });
});
