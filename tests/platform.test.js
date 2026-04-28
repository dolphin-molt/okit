import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'module';
import fse from 'fs-extra';

const mockStore = { get: vi.fn(), getAliases: vi.fn(), exportAll: vi.fn(), set: vi.fn() };
function MockVaultStore() { return mockStore; }

const mockSupabaseAdapter = {
  name: 'Supabase',
  testConnection: vi.fn(),
  syncSecrets: vi.fn(),
  pushSync: vi.fn(),
  pullSync: vi.fn(),
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../../vault/store') return { VaultStore: MockVaultStore };
  if (id === './platform-adapters/supabase') return mockSupabaseAdapter;
  return origRequire.apply(this, arguments);
};

const readJsonSpy = vi.spyOn(fse, 'readJson');
vi.spyOn(fse, 'pathExists').mockResolvedValue(true);
vi.spyOn(fse, 'ensureDir').mockResolvedValue(undefined);
vi.spyOn(fse, 'writeJson').mockResolvedValue(undefined);
vi.spyOn(fse, 'mkdirSync').mockReturnValue(undefined);
vi.spyOn(fse, 'appendFileSync').mockReturnValue(undefined);

const { testConnection, pushSecrets } = await import('../src/web/api/cloud-sync-core.js');

const VALID_CONFIG = {
  sync: {
    password: 'test-password',
    syncPlatform: 'supabase',
    machineId: 'machine-1',
    platforms: {
      supabase: { enabled: true, apiToken: 'SUPABASE_API_TOKEN', projectId: 'proj-123', storeId: 'store-1' },
    },
  },
};

const SAMPLE_SECRETS = [
  { key: 'OPEN_AI_KEY', alias: 'default', value: 'sk-abc123', group: 'AI', updatedAt: '2026-01-01T00:00:00Z' },
  { key: 'SILICONFLOW_API_KEY', alias: 'default', value: 'sk-xyz789', group: 'AI', updatedAt: '2026-01-02T00:00:00Z' },
  { key: 'OPEN_AI_KEY', alias: 'company', value: 'sk-company-abc', group: 'AI', updatedAt: '2026-01-03T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  readJsonSpy.mockResolvedValue({});
});

describe('testConnection', () => {
  it('throws when platform not configured', async () => {
    readJsonSpy.mockResolvedValue({ sync: { platforms: {} } });
    await expect(testConnection('supabase')).rejects.toThrow('平台 supabase 未配置');
  });

  it('calls adapter testConnection with resolved config', async () => {
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.get.mockResolvedValue('resolved-token');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.testConnection.mockResolvedValue('连接成功');

    const result = await testConnection('supabase');
    expect(result).toBe('连接成功');
    expect(mockSupabaseAdapter.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: 'resolved-token' })
    );
  });
});

describe('pushSecrets', () => {
  it('throws when platform not enabled', async () => {
    readJsonSpy.mockResolvedValue({
      sync: { platforms: { supabase: { enabled: false } } },
    });
    await expect(pushSecrets('supabase', null)).rejects.toThrow('平台 supabase 未启用');
  });

  it('pushes all secrets when keys is null', async () => {
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.syncSecrets.mockResolvedValue([
      { key: 'OPEN_AI_KEY', success: true },
      { key: 'SILICONFLOW_API_KEY', success: true },
    ]);

    const results = await pushSecrets('supabase', null);
    expect(results).toHaveLength(2);

    const callArgs = mockSupabaseAdapter.syncSecrets.mock.calls[0][1];
    const openAiGroup = callArgs.find((s) => s.key === 'OPEN_AI_KEY');
    expect(openAiGroup.aliases).toHaveLength(2);
  });

  it('filters secrets by keys when provided', async () => {
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.syncSecrets.mockResolvedValue([
      { key: 'OPEN_AI_KEY', success: true },
    ]);

    await pushSecrets('supabase', ['OPEN_AI_KEY']);

    const callArgs = mockSupabaseAdapter.syncSecrets.mock.calls[0][1];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0].key).toBe('OPEN_AI_KEY');
  });
});
