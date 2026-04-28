import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'module';
import fse from 'fs-extra';

const mockStore = { get: vi.fn(), getAliases: vi.fn(), exportAll: vi.fn(), set: vi.fn() };
function MockVaultStore() { return mockStore; }

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../../vault/store') return { VaultStore: MockVaultStore };
  return origRequire.apply(this, arguments);
};

vi.spyOn(fse, 'pathExists').mockResolvedValue(true);
vi.spyOn(fse, 'readJson').mockResolvedValue({});
vi.spyOn(fse, 'ensureDir').mockResolvedValue(undefined);
vi.spyOn(fse, 'writeJson').mockResolvedValue(undefined);
vi.spyOn(fse, 'mkdirSync').mockReturnValue(undefined);
vi.spyOn(fse, 'appendFileSync').mockReturnValue(undefined);

const { resolveVaultRefs } = await import('../src/web/api/cloud-sync-core.js');

beforeEach(() => {
  vi.clearAllMocks();
});

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
    mockStore.get.mockResolvedValueOnce(null).mockResolvedValueOnce('alias-value');
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

    await expect(resolveVaultRefs({ apiToken: 'MISSING_KEY' }))
      .rejects.toThrow('密钥 "MISSING_KEY" 不存在');
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
