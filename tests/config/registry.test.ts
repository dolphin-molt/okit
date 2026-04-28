import { describe, it, expect } from 'vitest';
import { resolveCmd } from '../../src/config/registry';
import type { PlatformCmd } from '../../src/config/registry';

describe('resolveCmd', () => {
  it('returns string command directly', () => {
    expect(resolveCmd('npm install')).toBe('npm install');
  });

  it('returns undefined for undefined input', () => {
    expect(resolveCmd(undefined)).toBeUndefined();
  });

  it('resolves platform-specific command on current platform', () => {
    const cmd: PlatformCmd = { darwin: 'brew install', linux: 'apt install', win32: 'choco install' };
    const result = resolveCmd(cmd);
    const platform = process.platform as keyof PlatformCmd;
    expect(result).toBe(cmd[platform]);
  });

  it('returns undefined for platform without command', () => {
    const cmd: PlatformCmd = { linux: 'apt install' };
    if (process.platform !== 'linux') {
      expect(resolveCmd(cmd)).toBeUndefined();
    } else {
      expect(resolveCmd(cmd)).toBe('apt install');
    }
  });

  it('handles empty PlatformCmd object', () => {
    expect(resolveCmd({})).toBeUndefined();
  });

  it('returns darwin command on macOS', () => {
    const cmd: PlatformCmd = { darwin: 'brew install' };
    if (process.platform === 'darwin') {
      expect(resolveCmd(cmd)).toBe('brew install');
    }
  });
});
