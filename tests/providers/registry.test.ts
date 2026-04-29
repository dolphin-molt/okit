import { describe, it, expect } from 'vitest';
import { getAdapters, getAdapter, getAdaptersByType } from '../../src/providers/registry';

describe('getAdapters', () => {
  it('returns 5 adapters', () => {
    const adapters = getAdapters();
    expect(adapters.length).toBe(5);
    const ids = adapters.map(a => a.id).sort();
    expect(ids).toEqual(['claude', 'codex', 'gemini', 'openclaw', 'opencode']);
  });
});

describe('getAdapter', () => {
  it('finds claude adapter by id', () => {
    const adapter = getAdapter('claude');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('Claude Code');
    expect(adapter!.supportedTypes).toEqual(['anthropic']);
  });

  it('finds codex adapter by id', () => {
    const adapter = getAdapter('codex');
    expect(adapter).toBeDefined();
    expect(adapter!.supportedTypes).toEqual(['openai']);
  });

  it('returns undefined for unknown id', () => {
    expect(getAdapter('unknown')).toBeUndefined();
  });
});

describe('getAdaptersByType', () => {
  it('finds anthropic-compatible adapters', () => {
    const adapters = getAdaptersByType('anthropic');
    const ids = adapters.map(a => a.id).sort();
    expect(ids).toContain('claude');
    expect(ids).toContain('openclaw');
    expect(ids).toContain('opencode');
  });

  it('finds openai-compatible adapters', () => {
    const adapters = getAdaptersByType('openai');
    const ids = adapters.map(a => a.id);
    expect(ids).toContain('codex');
    expect(ids).toContain('openclaw');
  });

  it('finds google-compatible adapters', () => {
    const adapters = getAdaptersByType('google');
    const ids = adapters.map(a => a.id);
    expect(ids).toContain('gemini');
  });
});
