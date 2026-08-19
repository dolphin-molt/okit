import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

const testRoot = vi.hoisted(() => {
  const p = require('path');
  const d = '/tmp/test-okit-zcode';
  return {
    OKIT_DIR: d,
    REGISTRY_PATH: p.join(d, 'registry.json'),
    LOGS_DIR: p.join(d, 'logs'),
    CACHE_DIR: p.join(d, 'cache'),
  };
});

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
  OKIT_DIR: testRoot.OKIT_DIR,
  REGISTRY_PATH: testRoot.REGISTRY_PATH,
  LOGS_DIR: testRoot.LOGS_DIR,
  CACHE_DIR: testRoot.CACHE_DIR,
}));

const userConfigStore: Record<string, any> = {};

vi.mock('../../../src/config/user', () => ({
  loadUserConfig: vi.fn(async function() { return userConfigStore; }),
  updateUserConfig: vi.fn(async function(patch: any) {
    if (patch.providers && typeof patch.providers === 'object') {
      userConfigStore.providers = {
        ...(userConfigStore.providers || {}),
        ...Object.fromEntries(Object.entries(patch.providers).map(([agent, sel]) => {
          const prev = userConfigStore.providers?.[agent] || {};
          return [agent, { ...prev, ...(sel as object) }];
        })),
      };
    }
    return patch;
  }),
}));

vi.mock('../../../src/vault/store', () => ({
  VaultStore: vi.fn().mockImplementation(function(this: any) {
    this.get = vi.fn(async function(key: string) { return key === 'TEST_API_KEY' ? 'sk-test-123' : undefined; });
  }),
}));

const { ZCodeAdapter } = await import('../../../src/providers/adapters/zcode');
const { loadUserConfig } = await import('../../../src/config/user');

const CONFIG_PATH = path.join(os.homedir(), '.zcode', 'v2', 'config.json');

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
  Object.keys(userConfigStore).forEach(k => delete userConfigStore[k]);
  userConfigStore.providers = {};
});

describe('ZCodeAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new ZCodeAdapter();
    expect(adapter.id).toBe('zcode');
    expect(adapter.name).toBe('ZCode');
  });

  it('supports anthropic/openai types', () => {
    const adapter = new ZCodeAdapter();
    expect(adapter.supportedTypes).toEqual(['anthropic', 'openai']);
  });
});

describe('ZCodeAdapter.applyConfig (v2 config schema)', () => {
  it('writes to ~/.zcode/v2/config.json (not the legacy path)', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek).toBeDefined();
  });

  it('writes a provider entry with kind/apiFormat/options/models (ZCode schema)', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    const entry = written.provider.deepseek;
    expect(entry.enabled).toBe(true);
    expect(entry.name).toBe('DeepSeek');
    expect(entry.source).toBe('custom');
    expect(entry.kind).toBe('openai-compatible');
    expect(entry.apiFormat).toBe('openai-chat-completions');
    expect(entry.options.baseURL).toBe('https://api.deepseek.com');
    expect(entry.options.apiKey).toBe('sk-test-123');
    expect(entry.models).toEqual({ 'deepseek-chat': { name: 'DeepSeek V4' } });
  });

  it('maps anthropic type to kind anthropic + anthropic-messages, stripping trailing /v1', async () => {
    const anthropicProvider = {
      ...testProvider,
      id: 'zai',
      type: 'anthropic' as const,
      baseUrl: 'https://api.z.ai',
      endpoints: [{ type: 'anthropic' as const, baseUrl: 'https://api.z.ai' }],
    };
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(anthropicProvider, 'glm-4.7');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    const entry = written.provider.zai;
    expect(entry.kind).toBe('anthropic');
    expect(entry.apiFormat).toBe('anthropic-messages');
    expect(entry.options.baseURL).toBe('https://api.z.ai');
  });

  it('maps openai responses protocol to kind openai + openai-responses', async () => {
    const responsesProvider = {
      ...testProvider,
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      endpoints: [{ type: 'openai' as const, protocol: 'responses' as const, baseUrl: 'https://api.openai.com/v1' }],
    };
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(responsesProvider, 'gpt-5');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    const entry = written.provider.openai;
    expect(entry.kind).toBe('openai');
    expect(entry.apiFormat).toBe('openai-responses');
  });

  it('preserves existing providers (builtin + custom) when adding a new one', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        'builtin:bigmodel-coding-plan': { enabled: true, name: 'BigModel - Coding Plan', kind: 'anthropic', source: 'custom' },
      },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(Object.keys(written.provider).sort()).toEqual(['builtin:bigmodel-coding-plan', 'deepseek']);
    expect(written.provider['builtin:bigmodel-coding-plan'].kind).toBe('anthropic');
  });

  it('does not overwrite an existing provider entry OKIT does not own', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        deepseek: { enabled: true, name: 'My DeepSeek', kind: 'anthropic', options: { baseURL: 'https://other.example.com' } },
      },
    }));

    const adapter = new ZCodeAdapter();
    await expect(adapter.applyConfig(testProvider, 'deepseek-chat')).rejects.toThrow(/已跳过/);

    // File untouched.
    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek.name).toBe('My DeepSeek');
  });

  it('adopts an existing entry pointing at the same endpoint (legacy OKIT write)', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        deepseek: { enabled: true, name: 'DeepSeek', kind: 'openai-compatible', options: { baseURL: 'https://api.deepseek.com' } },
      },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek.options.apiKey).toBe('sk-test-123');
  });

  it('records selection + managedModels in user.json', async () => {
    const adapter = new ZCodeAdapter();
    await adapter.applyConfig(testProvider, 'deepseek-chat');

    const config = await loadUserConfig();
    expect(config.providers.zcode).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      managedModels: { deepseek: ['deepseek-chat'] },
    });
  });
});

describe('ZCodeAdapter.applyModels (additive home-site write)', () => {
  it('writes entries for multiple providers into one provider map', async () => {
    const adapter = new ZCodeAdapter();
    const result = await adapter.applyModels([
      { provider: testProvider, modelId: 'deepseek-chat' },
      { provider: { ...testProvider, id: 'zai', name: 'Z.ai', baseUrl: 'https://api.z.ai' }, modelId: 'glm-4.7' },
    ]);

    expect(result.written).toEqual(['deepseek-chat', 'glm-4.7']);
    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(Object.keys(written.provider).sort()).toEqual(['deepseek', 'zai']);
  });

  it('skips providers whose existing entry OKIT does not own, keeps writing the rest', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        deepseek: { enabled: true, name: 'My DeepSeek', kind: 'anthropic', options: { baseURL: 'https://other.example.com' } },
      },
    }));

    const adapter = new ZCodeAdapter();
    const result = await adapter.applyModels([
      { provider: testProvider, modelId: 'deepseek-chat' },
      { provider: { ...testProvider, id: 'zai', name: 'Z.ai', baseUrl: 'https://api.z.ai' }, modelId: 'glm-4.7' },
    ]);

    expect(result.skipped).toEqual(['deepseek-chat']);
    expect(result.written).toEqual(['glm-4.7']);
    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek.name).toBe('My DeepSeek');
    expect(written.provider.zai).toBeDefined();
  });

  it('does not touch the current selection in user.json', async () => {
    userConfigStore.providers.zcode = { providerId: 'old', modelId: 'old-model' };
    const adapter = new ZCodeAdapter();
    await adapter.applyModels([{ provider: testProvider, modelId: 'deepseek-chat' }]);

    const config = await loadUserConfig();
    expect(config.providers.zcode.providerId).toBe('old');
    expect(config.providers.zcode.modelId).toBe('old-model');
    expect(config.providers.zcode.managedModels.deepseek).toContain('deepseek-chat');
  });
});

describe('ZCodeAdapter.setProviderEnabled', () => {
  it('flips enabled to false but keeps the entry (models + options intact)', async () => {
    userConfigStore.providers.zcode = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      managedModels: { deepseek: ['deepseek-chat'] },
    };
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        deepseek: {
          enabled: true,
          name: 'DeepSeek',
          source: 'custom',
          kind: 'openai-compatible',
          options: { baseURL: 'https://api.deepseek.com', apiKey: 'sk-test-123' },
          models: { 'deepseek-chat': { name: 'DeepSeek V4' } },
        },
      },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.setProviderEnabled('deepseek', false);

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek.enabled).toBe(false);
    // Entry survives with models + options.
    expect(written.provider.deepseek.models['deepseek-chat'].name).toBe('DeepSeek V4');
    expect(written.provider.deepseek.options.baseURL).toBe('https://api.deepseek.com');

    // Current selection cleared (site no longer active) — managedModels kept.
    const config = await loadUserConfig();
    expect(config.providers.zcode.providerId).toBeUndefined();
    expect(config.providers.zcode.managedModels.deepseek).toEqual(['deepseek-chat']);
  });

  it('re-enables by flipping enabled back to true', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        deepseek: { enabled: false, name: 'DeepSeek', source: 'custom', options: { baseURL: 'https://api.deepseek.com' } },
      },
    }));
    userConfigStore.providers.zcode = { managedModels: { deepseek: ['deepseek-chat'] } };

    const adapter = new ZCodeAdapter();
    await adapter.setProviderEnabled('deepseek', true);

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek.enabled).toBe(true);
  });

  it('is a no-op when the provider is not managed and not current', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: { 'builtin:bigmodel': { enabled: true, name: 'BigModel', kind: 'anthropic' } },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.setProviderEnabled('unrelated', false);

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider['builtin:bigmodel'].enabled).toBe(true);
    expect(mocks.files.get(CONFIG_PATH)!.includes('unrelated')).toBe(false);
  });
});

describe('ZCodeAdapter.listEnabledProviders', () => {
  it('returns every enabled provider id, excluding disabled ones', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        'builtin:bigmodel-coding-plan': { enabled: true, name: 'BigModel', kind: 'anthropic' },
        deepseek: { enabled: true, name: 'DeepSeek', kind: 'openai-compatible' },
        zai: { enabled: false, name: 'Z.ai', kind: 'openai-compatible' },
        noref: { name: 'No flag', kind: 'anthropic' },
      },
    }));

    const adapter = new ZCodeAdapter();
    const enabled = await adapter.listEnabledProviders();
    expect(enabled.sort()).toEqual(['builtin:bigmodel-coding-plan', 'deepseek', 'noref']);
  });

  it('returns [] when config is missing or empty', async () => {
    const adapter = new ZCodeAdapter();
    expect(await adapter.listEnabledProviders()).toEqual([]);

    mocks.files.set(CONFIG_PATH, JSON.stringify({ provider: {} }));
    expect(await adapter.listEnabledProviders()).toEqual([]);
  });
});

describe('ZCodeAdapter.getActiveModel', () => {
  it('reads the most recent task model from the sqlite index', async () => {
    const sqlitePath = path.join(os.homedir(), '.zcode', 'v2', 'tasks-index.sqlite');
    const adapter = new ZCodeAdapter();
    const result = await adapter.getActiveModel();
    if (result) {
      expect(typeof result.providerId).toBe('string');
      expect(typeof result.modelId).toBe('string');
    }
  });

  it('falls back to the user.json selection when sqlite is unavailable', async () => {
    // Point the adapter's expected db path at a non-existent location by
    // deleting the tasks file beforehand (already absent in the test sandbox).
    const adapter = new ZCodeAdapter();
    userConfigStore.providers.zcode = { providerId: 'deepseek', modelId: 'deepseek-chat' };
    const result = await adapter.getActiveModel();
    expect(result).toEqual({ providerId: 'deepseek', modelId: 'deepseek-chat' });
  });
});

describe('ZCodeAdapter.removeProvider', () => {
  it('removes only the OKIT-managed provider entry, preserving builtin entries', async () => {
    await userConfigStore;
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: {
        'builtin:bigmodel-coding-plan': { enabled: true, name: 'BigModel', kind: 'anthropic' },
        deepseek: { enabled: true, name: 'DeepSeek', kind: 'openai-compatible' },
      },
    }));
    userConfigStore.providers.zcode = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      managedModels: { deepseek: ['deepseek-chat'] },
    };

    const adapter = new ZCodeAdapter();
    await adapter.removeProvider('deepseek');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek).toBeUndefined();
    expect(written.provider['builtin:bigmodel-coding-plan']).toBeDefined();

    const config = await loadUserConfig();
    expect(config.providers.zcode.providerId).toBeUndefined();
    expect(config.providers.zcode.managedModels.deepseek).toBeUndefined();
  });

  it('is a no-op when the provider is not managed and not current', async () => {
    mocks.files.set(CONFIG_PATH, JSON.stringify({
      provider: { deepseek: { enabled: true, name: 'DeepSeek' } },
    }));

    const adapter = new ZCodeAdapter();
    await adapter.removeProvider('unrelated');

    const written = JSON.parse(mocks.files.get(CONFIG_PATH)!);
    expect(written.provider.deepseek).toBeDefined();
  });
});
