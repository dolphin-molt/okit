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
    ensureDir: vi.fn(async function() {}),
  };
});

vi.mock('fs-extra', () => ({ default: mocks }));

vi.mock('../../../src/config/registry', () => ({
  OKIT_DIR: '/tmp/test-okit-gemini',
  REGISTRY_PATH: '/tmp/test-okit-gemini/registry.json',
  LOGS_DIR: '/tmp/test-okit-gemini/logs',
  CACHE_DIR: '/tmp/test-okit-gemini/cache',
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

const { GeminiAdapter } = await import('../../../src/providers/adapters/gemini');
const { updateUserConfig } = await import('../../../src/config/user');

const ENV_PATH = path.join(os.homedir(), '.gemini', '.env');

// A non-official gateway (e.g. PackyCode) — must write GOOGLE_GEMINI_BASE_URL.
const gatewayProvider = {
  id: 'packy',
  name: 'PackyCode',
  type: 'google' as const,
  baseUrl: 'https://www.packyapi.com',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'gemini-3-pro' }],
};

// Official Google — should NOT write GOOGLE_GEMINI_BASE_URL.
const googleProvider = {
  id: 'google',
  name: 'Google Gemini',
  type: 'google' as const,
  baseUrl: 'https://generativelanguage.googleapis.com',
  vaultKey: 'TEST_API_KEY',
  authMode: 'api_key' as const,
  models: [{ id: 'gemini-3-pro' }],
};

// OAuth-only official Google (no vaultKey) — should clear stale .env.
const googleOAuthProvider = {
  id: 'google-agent',
  name: 'Gemini Agent Subscription',
  type: 'google' as const,
  baseUrl: 'https://generativelanguage.googleapis.com',
  authMode: 'oauth' as const,
  models: [{ id: 'gemini-3-pro' }],
};

beforeEach(() => {
  mocks.files.clear();
  vi.mocked(updateUserConfig).mockClear();
});

describe('GeminiAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.id).toBe('gemini');
    expect(adapter.name).toBe('Gemini');
  });

  it('supports google type only', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.supportedTypes).toEqual(['google']);
  });
});

describe('GeminiAdapter.applyConfig', () => {
  it('writes GEMINI_MODEL for API-key providers (was previously dropped)', async () => {
    const adapter = new GeminiAdapter();
    await adapter.applyConfig(gatewayProvider, 'gemini-3-pro');

    const env = mocks.files.get(ENV_PATH)!;
    expect(env).toContain('GEMINI_API_KEY=sk-test-123');
    expect(env).toContain('GOOGLE_API_KEY=sk-test-123');
    expect(env).toContain('GEMINI_MODEL=gemini-3-pro');
  });

  it('writes GOOGLE_GEMINI_BASE_URL for non-official gateways', async () => {
    const adapter = new GeminiAdapter();
    await adapter.applyConfig(gatewayProvider, 'gemini-3-pro');

    const env = mocks.files.get(ENV_PATH)!;
    expect(env).toContain('GOOGLE_GEMINI_BASE_URL=https://www.packyapi.com');
  });

  it('does NOT write GOOGLE_GEMINI_BASE_URL for official Google URL', async () => {
    const adapter = new GeminiAdapter();
    await adapter.applyConfig(googleProvider, 'gemini-3-pro');

    const env = mocks.files.get(ENV_PATH)!;
    expect(env).not.toContain('GOOGLE_GEMINI_BASE_URL');
  });

  it('clears stale API key when switching to official Google OAuth (no apiKey)', async () => {
    // Pre-existing stale key from a previous third-party setup
    mocks.files.set(ENV_PATH, 'GEMINI_API_KEY=stale-key\nGOOGLE_API_KEY=stale-key\n');

    const adapter = new GeminiAdapter();
    await adapter.applyConfig(googleOAuthProvider, 'gemini-3-pro');

    const env = mocks.files.get(ENV_PATH)!;
    expect(env).not.toContain('stale-key');
    expect(env).not.toContain('GEMINI_API_KEY=');
  });

  it('creates the .gemini directory', async () => {
    const adapter = new GeminiAdapter();
    await adapter.applyConfig(gatewayProvider, 'gemini-3-pro');

    expect(mocks.ensureDir).toHaveBeenCalled();
  });

  it('records selection in user.json', async () => {
    const adapter = new GeminiAdapter();
    await adapter.applyConfig(gatewayProvider, 'gemini-3-pro');

    expect(updateUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { gemini: { providerId: 'packy', modelId: 'gemini-3-pro' } },
      }),
    );
  });
});
