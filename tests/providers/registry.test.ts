import { describe, it, expect } from 'vitest';
import { getAdapters, getAdapter, getAdaptersByType } from '../../src/providers/registry';

describe('getAdapters', () => {
  it('returns 9 adapters', () => {
    const adapters = getAdapters();
    expect(adapters.length).toBe(9);
    const ids = adapters.map(a => a.id).sort();
    expect(ids).toEqual(['claude', 'codex', 'gemini', 'hermes', 'kimi-code', 'openclaw', 'opencode', 'workbuddy', 'zcode']);
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
    expect(adapter!.name).toBe('Codex');
    expect(adapter!.supportedTypes).toEqual(['openai']);
  });

  it('finds gemini adapter by id', () => {
    const adapter = getAdapter('gemini');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('Gemini');
    expect(adapter!.supportedTypes).toEqual(['google']);
  });

  it('finds workbuddy adapter by id', () => {
    const adapter = getAdapter('workbuddy');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('WorkBuddy');
    expect(adapter!.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });

  it('finds zcode adapter by id', () => {
    const adapter = getAdapter('zcode');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('ZCode');
    expect(adapter!.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });

  it('finds hermes adapter by id', () => {
    const adapter = getAdapter('hermes');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('Hermes');
    expect(adapter!.supportedTypes).toEqual(['anthropic', 'openai', 'google']);
  });

  it('finds kimi-code adapter by id', () => {
    const adapter = getAdapter('kimi-code');
    expect(adapter).toBeDefined();
    expect(adapter!.name).toBe('Kimi Code');
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
    expect(ids).toContain('workbuddy');
    expect(ids).toContain('zcode');
    expect(ids).toContain('hermes');
  });

  it('finds google-compatible adapters', () => {
    const adapters = getAdaptersByType('google');
    const ids = adapters.map(a => a.id);
    expect(ids).toContain('gemini');
    expect(ids).toContain('workbuddy');
    expect(ids).toContain('zcode');
    expect(ids).toContain('hermes');
  });
});
