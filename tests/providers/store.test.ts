import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    pathExists: vi.fn(async (p: string) => files.has(p)),
    readFile: vi.fn(async (p: string) => files.get(p) ?? ''),
    writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
    ensureDir: vi.fn(async () => {}),
  };
});

vi.mock('fs-extra', () => ({ default: mocks }));

vi.mock('../../src/config/registry', () => ({
  OKIT_DIR: '/tmp/test-okit-providers',
  REGISTRY_PATH: '/tmp/test-okit-providers/registry.json',
  LOGS_DIR: '/tmp/test-okit-providers/logs',
  CACHE_DIR: '/tmp/test-okit-providers/cache',
}));

const { loadProviders, saveProviders, getProvider, addProvider, deleteProvider } = await import('../../src/providers/store');

const PROVIDERS_PATH = '/tmp/test-okit-providers/providers.json';

const sampleProvider = {
  id: 'test-provider',
  name: 'Test Provider',
  type: 'anthropic' as const,
  baseUrl: 'https://api.test.com',
  authMode: 'api_key' as const,
  models: [{ id: 'model-1' }, { id: 'model-2' }],
};

beforeEach(() => {
  mocks.files.clear();
});

describe('loadProviders', () => {
  it('returns preset providers when file does not exist', async () => {
    const result = await loadProviders();
    expect(result.length).toBeGreaterThan(0);
    // Verify presets were saved
    const saved = mocks.files.get(PROVIDERS_PATH);
    expect(saved).toBeTruthy();
  });

  it('loads providers from valid JSON', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    const result = await loadProviders();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test-provider');
    expect(result[0].models.length).toBe(2);
  });

  it('returns empty array for invalid JSON', async () => {
    mocks.files.set(PROVIDERS_PATH, 'not json');
    const result = await loadProviders();
    expect(result).toEqual([]);
  });

  it('filters out invalid providers', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({
      providers: [
        sampleProvider,
        { id: 'bad', name: 123 }, // invalid: name is not string
        { id: 'also-bad' },       // invalid: missing fields
      ],
    }));
    const result = await loadProviders();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('test-provider');
  });

  it('returns empty when providers is not an array', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: 'not-array' }));
    const result = await loadProviders();
    expect(result).toEqual([]);
  });
});

describe('saveProviders', () => {
  it('writes providers to disk', async () => {
    await saveProviders([sampleProvider]);
    expect(mocks.ensureDir).toHaveBeenCalled();
    const written = mocks.files.get(PROVIDERS_PATH);
    expect(written).toBeTruthy();
    const parsed = JSON.parse(written!);
    expect(parsed.providers.length).toBe(1);
    expect(parsed.providers[0].id).toBe('test-provider');
  });
});

describe('getProvider', () => {
  it('returns provider by id', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    const result = await getProvider('test-provider');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Test Provider');
  });

  it('returns undefined for unknown id', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    const result = await getProvider('unknown');
    expect(result).toBeUndefined();
  });
});

describe('addProvider', () => {
  it('adds a new provider on top of presets', async () => {
    await addProvider(sampleProvider);
    const written = JSON.parse(mocks.files.get(PROVIDERS_PATH)!);
    // loadProviders creates presets, then addProvider appends
    expect(written.providers).toContainEqual(expect.objectContaining({ id: 'test-provider' }));
  });

  it('updates existing provider with same id', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    await addProvider({ ...sampleProvider, name: 'Updated' });
    const written = JSON.parse(mocks.files.get(PROVIDERS_PATH)!);
    expect(written.providers.length).toBe(1);
    expect(written.providers[0].name).toBe('Updated');
  });

  it('appends to existing providers', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    await addProvider({ id: 'second', name: 'Second', type: 'openai', baseUrl: 'https://second.com', authMode: 'api_key', models: [] });
    const written = JSON.parse(mocks.files.get(PROVIDERS_PATH)!);
    expect(written.providers.length).toBe(2);
  });
});

describe('deleteProvider', () => {
  it('removes provider by id', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    const result = await deleteProvider('test-provider');
    expect(result).toBe(true);
    const written = JSON.parse(mocks.files.get(PROVIDERS_PATH)!);
    expect(written.providers.length).toBe(0);
  });

  it('returns false for unknown id', async () => {
    mocks.files.set(PROVIDERS_PATH, JSON.stringify({ providers: [sampleProvider] }));
    const result = await deleteProvider('unknown');
    expect(result).toBe(false);
  });
});
