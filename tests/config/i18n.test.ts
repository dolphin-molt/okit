import { describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/config/user', () => ({
  loadUserConfig: vi.fn().mockResolvedValue({}),
  updateUserConfig: vi.fn().mockResolvedValue({}),
}));

const { setLanguage, getLanguage, t } = await import('../../src/config/i18n');

describe('i18n', () => {
  beforeEach(() => {
    setLanguage('zh');
  });

  it('defaults to Chinese', () => {
    expect(getLanguage()).toBe('zh');
  });

  it('switches to English and back', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    setLanguage('zh');
    expect(getLanguage()).toBe('zh');
  });

  it('returns Chinese translations', () => {
    setLanguage('zh');
    expect(t('install')).toBe('安装');
    expect(t('exit')).toBe('退出');
    expect(t('success')).toBe('成功');
    expect(t('failed')).toBe('失败');
  });

  it('returns English translations', () => {
    setLanguage('en');
    expect(t('install')).toBe('Install');
    expect(t('exit')).toBe('Exit');
    expect(t('success')).toBe('Success');
    expect(t('failed')).toBe('Failed');
  });

  it('t() returns non-empty string for valid keys', () => {
    expect(typeof t('title')).toBe('string');
    expect(t('title').length).toBeGreaterThan(0);
  });

  it('handles vault-related keys', () => {
    setLanguage('zh');
    expect(t('vaultSaved')).toBe('已保存:');
    setLanguage('en');
    expect(t('vaultSaved')).toBe('Saved:');
  });

  it('handles check-related keys', () => {
    setLanguage('zh');
    expect(t('checkInstalled')).toBe('已安装');
    setLanguage('en');
    expect(t('checkInstalled')).toBe('Installed');
  });
});
