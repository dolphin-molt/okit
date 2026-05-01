import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'module';
import os from 'os';

vi.spyOn(os, 'homedir').mockReturnValue('/tmp/test-okit-cloud-sync');

const mockFs = vi.hoisted(() => ({
  readJson: vi.fn(),
  readFile: vi.fn(),
  pathExists: vi.fn(),
  ensureDir: vi.fn(),
  writeJson: vi.fn(),
  writeFile: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('fs-extra', () => ({ default: mockFs, ...mockFs }));

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
  if (id === 'fs-extra') return mockFs;
  if (id === '../../vault/store') return { VaultStore: MockVaultStore };
  if (id === './platform-adapters/supabase') return mockSupabaseAdapter;
  return origRequire.apply(this, arguments);
};

const { syncPush, syncPull, exportSyncCode, importSyncCode } = await import('../src/web/api/cloud-sync-core.js');

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
  mockFs.pathExists.mockResolvedValue(true);
  mockFs.readJson.mockResolvedValue({});
  mockFs.readFile.mockResolvedValue(JSON.stringify({ providers: [] }));
  mockFs.ensureDir.mockResolvedValue(undefined);
  mockFs.writeJson.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
  mockFs.mkdirSync.mockReturnValue(undefined);
  mockFs.appendFileSync.mockReturnValue(undefined);
});

describe('syncPush', () => {
  it('throws when no password set', async () => {
    mockFs.readJson.mockResolvedValue({ sync: { password: null, platforms: {} } });
    await expect(syncPush()).rejects.toThrow('请先设置同步密码');
  });

  it('throws when no enabled platform', async () => {
    mockFs.readJson.mockResolvedValue({ sync: { password: 'x', platforms: {} } });
    await expect(syncPush()).rejects.toThrow('请先启用一个同步平台');
  });

  it('encrypts and pushes secrets, updates lastSyncAt', async () => {
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
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

    const savedConfig = mockFs.writeJson.mock.calls[0][1];
    expect(savedConfig.sync.lastSyncAt).toBeTruthy();
  });

  it('generates machineId if missing', async () => {
    const config = JSON.parse(JSON.stringify(VALID_CONFIG));
    delete config.sync.machineId;
    mockFs.readJson.mockResolvedValue(config);
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.pushSync.mockResolvedValue(undefined);

    await syncPush();

    const savedConfig = mockFs.writeJson.mock.calls[0][1];
    expect(savedConfig.sync.machineId).toBeTruthy();
  });
});

describe('syncPull', () => {
  it('throws when no password set', async () => {
    mockFs.readJson.mockResolvedValue({ sync: { password: null, platforms: {} } });
    await expect(syncPull()).rejects.toThrow('请先设置同步密码');
  });

  it('throws when no enabled platform', async () => {
    mockFs.readJson.mockResolvedValue({ sync: { password: 'x', platforms: {} } });
    await expect(syncPull()).rejects.toThrow('请先启用一个同步平台');
  });

  it('throws when remote has no data', async () => {
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);
    mockSupabaseAdapter.pullSync.mockResolvedValue(null);

    await expect(syncPull()).rejects.toThrow('远端没有同步数据');
  });

  it('decrypts and merges remote secrets', async () => {
    // Phase 1: push to get a valid encrypted blob
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
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

    const savedConfig = mockFs.writeJson.mock.calls[1][1];
    expect(savedConfig.sync.lastSyncAt).toBeTruthy();
  });

  it('merges agent settings from remote', async () => {
    // Phase 1: push
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
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
    mockFs.readJson.mockResolvedValue(pullConfig);
    mockSupabaseAdapter.pullSync.mockResolvedValue(encryptedBlob);

    await syncPull();

    const savedConfig = mockFs.writeJson.mock.calls[1][1];
    expect(savedConfig.agent).toBeDefined();
  });

  it('syncs model provider configuration including vault key bindings', async () => {
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      providers: [
        {
          id: 'custom-ai',
          name: 'Custom AI',
          type: 'openai',
          baseUrl: 'https://api.example.com/v1',
          authMode: 'api_key',
          vaultKey: 'CUSTOM_AI_KEY',
          models: [{ id: 'custom-model', name: 'Custom Model' }],
        },
      ],
    }));
    mockStore.exportAll.mockResolvedValue(SAMPLE_SECRETS);
    mockStore.get.mockResolvedValue('resolved');
    mockStore.getAliases.mockResolvedValue([]);

    let encryptedBlob;
    mockSupabaseAdapter.pushSync.mockImplementation(async (cfg, userId, blob) => {
      encryptedBlob = blob;
    });
    await syncPush();

    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
    mockFs.readFile.mockResolvedValue(JSON.stringify({ providers: [] }));
    mockStore.exportAll.mockResolvedValue([]);
    mockSupabaseAdapter.pullSync.mockResolvedValue(encryptedBlob);

    await syncPull();

    const providerWrite = mockFs.writeFile.mock.calls.find(([file]) => String(file).endsWith('providers.json'));
    expect(providerWrite).toBeTruthy();
    const written = JSON.parse(providerWrite[1]);
    expect(written.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-ai', vaultKey: 'CUSTOM_AI_KEY' }),
    ]));
  });
});

describe('sync code', () => {
  it('uses the saved sync password when exporting sync code', async () => {
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue([
      { key: 'SUPABASE_API_TOKEN', alias: 'default', value: 'sb-secret', group: 'Supabase', updatedAt: '2026-01-04T00:00:00Z' },
    ]);

    const result = await exportSyncCode();

    expect(result.code).toMatch(/^okit-sync:/);
    expect(result.secrets).toBe(1);
  });

  it('requires a sync password when exporting sync code without a saved password', async () => {
    const config = JSON.parse(JSON.stringify(VALID_CONFIG));
    config.sync.password = '';
    mockFs.readJson.mockResolvedValue(config);
    await expect(exportSyncCode()).rejects.toThrow('请先设置同步密码');
  });

  it('exports platform config with referenced vault secrets encrypted by sync password', async () => {
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue([
      { key: 'SUPABASE_API_TOKEN', alias: 'default', value: 'sb-secret', group: 'Supabase', updatedAt: '2026-01-04T00:00:00Z' },
      ...SAMPLE_SECRETS,
    ]);

    const result = await exportSyncCode('test-password');

    expect(result.code).toMatch(/^okit-sync:/);
    expect(result.platform).toBe('supabase');
    expect(result.secrets).toBe(1);
    expect(result.code).not.toContain('sk-abc123');
  });

  it('exports referenced vault secret when platform config omits alias but vault uses a custom alias', async () => {
    const config = JSON.parse(JSON.stringify(VALID_CONFIG));
    config.sync.platforms.supabase.apiToken = 'SUPABASE_API_TOKEN';
    mockFs.readJson.mockResolvedValue(config);
    mockStore.exportAll.mockResolvedValue([
      { key: 'SUPABASE_API_TOKEN', alias: 'service-role', value: 'sb-secret', group: 'Supabase', updatedAt: '2026-01-04T00:00:00Z' },
    ]);

    const result = await exportSyncCode('test-password');

    expect(result.secrets).toBe(1);
  });

  it('throws when platform config references a vault key that does not exist', async () => {
    mockFs.readJson.mockResolvedValue(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue([]);

    await expect(exportSyncCode('test-password')).rejects.toThrow('配置引用的密钥不存在：SUPABASE_API_TOKEN');
  });

  it('imports sync code by creating referenced vault secrets before saving platform config', async () => {
    mockFs.readJson.mockResolvedValueOnce(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue([
      { key: 'SUPABASE_API_TOKEN', alias: 'default', value: 'sb-secret', group: 'Supabase', updatedAt: '2026-01-04T00:00:00Z' },
      ...SAMPLE_SECRETS,
    ]);
    const exported = await exportSyncCode('test-password');

    mockFs.readJson.mockResolvedValueOnce({ sync: { platforms: {} } });
    mockStore.set.mockResolvedValue(undefined);

    const result = await importSyncCode(exported.code, 'test-password');

    expect(result.platform).toBe('supabase');
    expect(result.secrets).toBe(1);
    expect(mockStore.set).toHaveBeenCalledWith('SUPABASE_API_TOKEN', 'sb-secret', 'Supabase', undefined);

    const savedConfig = mockFs.writeJson.mock.calls.at(-1)[1];
    expect(savedConfig.sync.password).toBe('test-password');
    expect(savedConfig.sync.syncPlatform).toBe('supabase');
    expect(savedConfig.sync.platforms.supabase.enabled).toBe(true);
    expect(savedConfig.sync.platforms.supabase.apiToken).toBe('SUPABASE_API_TOKEN');
  });

  it('rejects sync code import with a wrong password before writing vault or platform config', async () => {
    mockFs.readJson.mockResolvedValueOnce(VALID_CONFIG);
    mockStore.exportAll.mockResolvedValue([
      { key: 'SUPABASE_API_TOKEN', alias: 'default', value: 'sb-secret', group: 'Supabase', updatedAt: '2026-01-04T00:00:00Z' },
    ]);
    const exported = await exportSyncCode('test-password');

    await expect(importSyncCode(exported.code, 'wrong-password')).rejects.toThrow('同步密码不正确');
    expect(mockStore.set).not.toHaveBeenCalled();
    expect(mockFs.writeJson).not.toHaveBeenCalled();
  });
});
