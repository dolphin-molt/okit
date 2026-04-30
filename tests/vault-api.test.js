import { describe, it, expect, vi, beforeEach } from 'vitest';
import Module from 'module';
import fse from 'fs-extra';

const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  getBindings: vi.fn(),
};
function MockVaultStore() { return mockStore; }

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../../vault/store') return { VaultStore: MockVaultStore };
  return origRequire.apply(this, arguments);
};

vi.spyOn(fse, 'existsSync').mockReturnValue(false);
vi.spyOn(fse, 'mkdirSync').mockReturnValue(undefined);
vi.spyOn(fse, 'appendFileSync').mockReturnValue(undefined);

const { setVault } = await import('../src/web/api/vault.js');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fse.existsSync.mockReturnValue(false);
});

describe('vault api setVault', () => {
  it('moves an edited secret when key or alias changes', async () => {
    mockStore.get
      .mockResolvedValueOnce('old-value')
      .mockResolvedValueOnce(null);
    const res = createResponse();

    await setVault({
      body: {
        key: 'NEW_KEY',
        alias: 'team',
        value: 'new-value',
        group: 'NPM',
        originalKey: 'OLD_KEY',
        originalAlias: 'default',
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, key: 'NEW_KEY', alias: 'team' });
    expect(mockStore.get).toHaveBeenNthCalledWith(1, 'OLD_KEY');
    expect(mockStore.get).toHaveBeenNthCalledWith(2, 'NEW_KEY/team');
    expect(mockStore.set).toHaveBeenCalledWith('NEW_KEY/team', 'new-value', 'NPM', undefined);
    expect(mockStore.delete).toHaveBeenCalledWith('OLD_KEY');
  });

  it('rejects editing onto an existing target secret', async () => {
    mockStore.get
      .mockResolvedValueOnce('old-value')
      .mockResolvedValueOnce('existing-value');
    const res = createResponse();

    await setVault({
      body: {
        key: 'EXISTING_KEY',
        alias: 'default',
        value: 'new-value',
        originalKey: 'OLD_KEY',
        originalAlias: 'default',
      },
    }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('already exists');
    expect(mockStore.set).not.toHaveBeenCalled();
    expect(mockStore.delete).not.toHaveBeenCalled();
  });
});
