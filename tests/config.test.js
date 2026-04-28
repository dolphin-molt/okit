import { describe, it, expect, vi, beforeEach } from 'vitest';
import fse from 'fs-extra';

const readJsonSpy = vi.spyOn(fse, 'readJson');
const pathExistsSpy = vi.spyOn(fse, 'pathExists');
const ensureDirSpy = vi.spyOn(fse, 'ensureDir');
const writeJsonSpy = vi.spyOn(fse, 'writeJson');
const mkdirSyncSpy = vi.spyOn(fse, 'mkdirSync');
const appendFileSyncSpy = vi.spyOn(fse, 'appendFileSync');

const { loadConfig, saveConfig } = await import('../src/web/api/cloud-sync-core.js');

beforeEach(() => {
  vi.clearAllMocks();
  pathExistsSpy.mockResolvedValue(true);
  readJsonSpy.mockResolvedValue({});
  ensureDirSpy.mockResolvedValue(undefined);
  writeJsonSpy.mockResolvedValue(undefined);
  mkdirSyncSpy.mockReturnValue(undefined);
  appendFileSyncSpy.mockReturnValue(undefined);
});

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
