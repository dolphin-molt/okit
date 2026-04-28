import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Module from 'module';

// ─── Set up mocks BEFORE importing the module under test ───

// 1. Spy on real fs-extra methods (works because all callers share the same module object)
import fse from 'fs-extra';
const pathExistsSpy = vi.spyOn(fse, 'pathExists');
const readJsonSpy = vi.spyOn(fse, 'readJson');
const ensureDirSpy = vi.spyOn(fse, 'ensureDir');
const writeJsonSpy = vi.spyOn(fse, 'writeJson');
const mkdirSyncSpy = vi.spyOn(fse, 'mkdirSync');
const appendFileSyncSpy = vi.spyOn(fse, 'appendFileSync');

// 2. Mock VaultStore
const mockStore = {
  get: vi.fn(),
  getAliases: vi.fn(),
  exportAll: vi.fn(),
  set: vi.fn(),
};
function MockVaultStore() { return mockStore; }

// 3. Mock platform adapter
const mockSupabaseAdapter = {
  name: 'Supabase',
  testConnection: vi.fn(),
  syncSecrets: vi.fn(),
  pushSync: vi.fn(),
  pullSync: vi.fn(),
};

// Intercept CJS require() calls from cloud-sync-core.js
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../../vault/store') return { VaultStore: MockVaultStore };
  if (id === './platform-adapters/supabase') return mockSupabaseAdapter;
  return originalRequire.apply(this, arguments);
};

const { loadConfig, saveConfig, resolveVaultRefs, testConnection, pushSecrets, syncPush, syncPull } = await import('../src/web/api/cloud-sync-core.js');

const VALID_CONFIG = {
  sync: {
    password: 'test-password',
    syncPlatform: 'supabase',
    machineId: 'machine-1',
    platforms: {
      supabase: {
        enabled: true,
        apiToken: 'SUPABASE_API_TOKEN',
        projectId: 'proj-123',
        storeId: 'store-1',
      },
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
  pathExistsSpy.mockResolvedValue(true);
  readJsonSpy.mockResolvedValue({});
  ensureDirSpy.mockResolvedValue(undefined);
  writeJsonSpy.mockResolvedValue(undefined);
  mkdirSyncSpy.mockReturnValue(undefined);
  appendFileSyncSpy.mockReturnValue(undefined);
});

// ─── loadConfig ───

describe('loadConfig', () => {
  it('returns config when file exists', async () => {
    readJsonSpy.mockResolvedValue({ sync: { password: 'x' } });
    const result = await loadConfig();
    expect(result).toEqual({ sync: { password: 'x' } });
  });

  it('returns empty object when file does not exist', async () => {
    pathExistsSpy.mockResolvedValue(false);
    const result = await loadConfig();
    expect(result).toEqual({});
  });

  it('returns empty object when file is corrupted', async () => {
    pathExistsSpy.mockResolvedValue(true);
    readJsonSpy.mockRejectedValue(new Error('bad json'));
    const result = await loadConfig();
    expect(result).toEqual({});
  });
});

// ─── saveConfig ───

describe('saveConfig', () => {
  it('writes config to disk', async () => {
    const config = { sync: { password: 'new' } };
    await saveConfig(config);
    expect(ensureDirSpy).toHaveBeenCalled();
    expect(writeJsonSpy).toHaveBeenCalled();
    const [, writtenConfig] = writeJsonSpy.mock.calls[0];
    expect(writtenConfig).toEqual(config);
  });
});

// ─── resolveVaultRefs ───

describe('resolveVaultRefs', () => {
  it('resolves vault-key-pattern fields from vault', async () => {
    mockStore.get.mockImplementation(async (key) => {
      if (key === 'SUPABASE_API_TOKEN') return 'real-token-value';
      return null;
    });
    mockStore.getAliases.mockResolvedValue([]);

    const result = await resolveVaultRefs({
      apiToken: 'SUPABASE_API_TOKEN',
      projectId: 'my-project',
    });

    expect(result.apiToken).toBe('real-token-value');
    expect(result.projectId).toBe('my-project');
  });

  it('tries aliases when direct get returns null', async () => {
    mockStore.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('alias-value');
    mockStore.getAliases.mockResolvedValue(['company']);

    const result = await resolveVaultRefs({ apiToken: 'MY_SECRET' });
    expect(result.apiToken).toBe('alias-value');
  });

  it('skips non-secret fields like storeId and databaseId', async () => {
    const result = await resolveVaultRefs({
      storeId: 'MY_STORE_ID',
      databaseId: 'MY_DB_ID',
      region: 'us-east-1',
    });
    expect(result.storeId).toBe('MY_STORE_ID');
    expect(result.databaseId).toBe('MY_DB_ID');
    expect(result.region).toBe('us-east-1');
  });

  it('keeps non-vault-pattern values unchanged', async () => {
    const result = await resolveVaultRefs({
      apiToken: 'literal-token-value',
      bucketName: 'my-bucket',
    });
    expect(result.apiToken).toBe('literal-token-value');
  });

  it('throws when vault key does not exist', async () => {
    mockStore.get.mockResolvedValue(null);
    mockStore.getAliases.mockResolvedValue([]);

    await expect(
      resolveVaultRefs({ apiToken: 'MISSING_KEY' })
    ).rejects.toThrow('密钥 "MISSING_KEY" 不存在');
  });

  it('does not resolve lowercase or short values', async () => {
    const result = await resolveVaultRefs({
      apiToken: 'abc',
      accessToken: 'not-uppercase',
    });
    expect(result.apiToken).toBe('abc');
    expect(result.accessToken).toBe('not-uppercase');
  });
});

// ─── testConnection ───

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

// ─── pushSecrets ───

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

// ─── syncPush ───

describe('syncPush', () => {
  it('throws when no password set', async () => {
    readJsonSpy.mockResolvedValue({ sync: { password: null, platforms: {} } });
    await expect(syncPush()).rejects.toThrow('请先设置同步密码');
  });

  it('throws when no enabled platform', async () => {
    readJsonSpy.mockResolvedValue({ sync: { password: 'x', platforms: {} } });
    await expect(syncPush()).rejects.toThrow('请先启用一个同步平台');
  });

  it('encrypts and pushes secrets, updates lastSyncAt', async () => {
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.pushSync.mockResolvedValue(undefined);

    const result = await syncPush();

    expect(result.secrets).toBe(3);
    expect(mockSupabaseAdapter.pushSync).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: 'resolved' }),
      expect.any(String),
      expect.objectContaining({
        nonce: expect.any(String),
        ciphertext: expect.any(String),
        tag: expect.any(String),
      })
    );

    const savedConfig = writeJsonSpy.mock.calls[0][1];
    expect(savedConfig.sync.lastSyncAt).toBeTruthy();
  });

  it('generates machineId if missing', async () => {
    const config = JSON.parse(JSON.stringify(VALID_CONFIG));
    delete config.sync.machineId;
    readJsonSpy.mockResolvedValue(config);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.pushSync.mockResolvedValue(undefined);

    await syncPush();

    const savedConfig = writeJsonSpy.mock.calls[0][1];
    expect(savedConfig.sync.machineId).toBeTruthy();
  });
});

// ─── syncPull ───

describe('syncPull', () => {
  it('throws when no password set', async () => {
    readJsonSpy.mockResolvedValue({ sync: { password: null, platforms: {} } });
    await expect(syncPull()).rejects.toThrow('请先设置同步密码');
  });

  it('throws when no enabled platform', async () => {
    readJsonSpy.mockResolvedValue({ sync: { password: 'x', platforms: {} } });
    await expect(syncPull()).rejects.toThrow('请先启用一个同步平台');
  });

  it('throws when remote has no data', async () => {
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.pullSync.mockResolvedValue(null);

    await expect(syncPull()).rejects.toThrow('远端没有同步数据');
  });

  it('decrypts and merges remote secrets', async () => {
    // Phase 1: push to get a valid encrypted blob
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);

    let encryptedBlob;
    mockSupabaseAdapter.pushSync.mockImplementation(async (cfg, userId, blob) => {
      encryptedBlob = blob;
    });

    await syncPush();
    expect(encryptedBlob).toBeTruthy();

    // Phase 2: pull back
    const localSecrets = [
      { key: 'OPEN_AI_KEY', alias: 'default', value: 'sk-old', group: 'AI', updatedAt: '2025-01-01T00:00:00Z' },
    ];
    mockStore.exportAll.mockResolvedValue(localSecrets);
    mockStore.set.mockResolvedValue(undefined);
    mockSupabaseAdapter.pullSync.mockResolvedValue(encryptedBlob);

    const result = await syncPull();

    expect(result.added).toBeGreaterThanOrEqual(1);
    expect(mockStore.set).toHaveBeenCalled();

    const savedConfig = writeJsonSpy.mock.calls[1][1];
    expect(savedConfig.sync.lastSyncAt).toBeTruthy();
  });

  it('merges agent settings from remote', async () => {
    // Phase 1: push
    readJsonSpy.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);

    let encryptedBlob;
    mockSupabaseAdapter.pushSync.mockImplementation(async (cfg, userId, blob) => {
      encryptedBlob = blob;
    });

    await syncPush();

    // Phase 2: pull with agent config
    const pullConfig = JSON.parse(JSON.stringify(VALID_CONFIG));
    pullConfig.agent = { provider: 'openai' };
    mockStore.exportAll.mockResolvedValue([]);
    readJsonSpy.mockResolvedValue(pullConfig);
    mockSupabaseAdapter.pullSync.mockResolvedValue(encryptedBlob);

    await syncPull();

    const savedConfig = writeJsonSpy.mock.calls[1][1];
    expect(savedConfig.agent).toBeDefined();
  });
});
