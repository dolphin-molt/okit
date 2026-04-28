import { describe, it, expect } from 'vitest';
import { VaultStore } from '../../src/vault/store';

describe('VaultStore.parseKeyAlias', () => {
  it('parses simple key with default alias', () => {
    expect(VaultStore.parseKeyAlias('KEY')).toEqual({ key: 'KEY', alias: 'default' });
  });

  it('parses KEY/alias format', () => {
    expect(VaultStore.parseKeyAlias('GITHUB_TOKEN/company')).toEqual({
      key: 'GITHUB_TOKEN',
      alias: 'company',
    });
  });

  it('parses key with slash in alias', () => {
    expect(VaultStore.parseKeyAlias('KEY/a/b')).toEqual({ key: 'KEY', alias: 'a/b' });
  });

  it('handles empty string', () => {
    expect(VaultStore.parseKeyAlias('')).toEqual({ key: '', alias: 'default' });
  });

  it('handles trailing slash', () => {
    expect(VaultStore.parseKeyAlias('KEY/')).toEqual({ key: 'KEY', alias: '' });
  });
});
