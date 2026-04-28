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
const writeJsonSpy = vi.spyOn(fse, 'writeJson');
vi.spyOn(fse, 'pathExists').mockResolvedValue(true);
vi.spyOn(fse, 'ensureDir').mockResolvedValue(undefined);
vi.spyOn(fse, 'mkdirSync').mockReturnValue(undefined);
vi.spyOn(fse, 'appendFileSync').mockReturnValue(undefined);

const { syncPush, syncPull } = await import('../src/web/api/cloud-sync-core.js');

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
