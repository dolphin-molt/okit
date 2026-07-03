import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/vault/store', () => ({
  VaultStore: Object.assign(vi.fn().mockImplementation(function(this: any) {
    this.get = vi.fn(async () => null);
    this.resolve = vi.fn(async (key: string, alias?: string) => {
      if (key === 'SERVICE_KEY' && alias === 'team') return 'secret-value';
      return null;
    });
  }), {
    parseKeyAlias(input: string) {
      const slashIdx = input.indexOf('/');
      if (slashIdx === -1) return { key: input, alias: 'default' };
      return { key: input.slice(0, slashIdx), alias: input.slice(slashIdx + 1) };
    },
  }),
}));

const { checkVaultKey } = await import('../../src/providers/auth');

describe('checkVaultKey', () => {
  it('recognizes explicit vault aliases', async () => {
    await expect(checkVaultKey('SERVICE_KEY/team')).resolves.toBe(true);
  });
});
