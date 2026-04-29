import { describe, it, expect } from 'vitest';
import { PRESET_PROVIDERS } from '../../src/providers/presets';

describe('PRESET_PROVIDERS alignment', () => {
  const EXPECTED_IDS = [
    'anthropic', 'openai', 'openai-codex', 'google', 'volcengine',
    'zai', 'minimax', 'deepseek', 'moonshot', 'kimi-coding',
    'qwen', 'qianfan', 'xai', 'mistral', 'stepfun', 'xiaomi',
    'openrouter', 'groq', 'fireworks', 'together', 'ollama', 'litellm',
  ];

  it('has exactly 22 presets', () => {
    expect(PRESET_PROVIDERS.length).toBe(22);
  });

  it('contains all expected provider IDs', () => {
    const ids = PRESET_PROVIDERS.map(p => p.id);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('has no duplicate IDs', () => {
    const ids = PRESET_PROVIDERS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('multi-endpoint providers have endpoints array', () => {
    const multiEndpoint = ['google', 'zai', 'deepseek', 'qianfan', 'xiaomi'];
    for (const id of multiEndpoint) {
      const p = PRESET_PROVIDERS.find(p => p.id === id);
      expect(p, `${id} should have endpoints`).toBeDefined();
      expect(p!.endpoints!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('each endpoint has valid type and baseUrl', () => {
    for (const p of PRESET_PROVIDERS) {
      if (!p.endpoints) continue;
      for (const ep of p.endpoints) {
        expect(ep.type).toMatch(/^(anthropic|openai|google)$/);
        expect(ep.baseUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it('non-local providers have at least 1 model', () => {
    const localProviders = ['ollama', 'litellm'];
    for (const p of PRESET_PROVIDERS) {
      if (localProviders.includes(p.id)) continue;
      expect(p.models.length, `${p.id} should have models`).toBeGreaterThan(0);
    }
  });

  it('all model IDs are unique within each provider', () => {
    for (const p of PRESET_PROVIDERS) {
      const ids = p.models.map(m => m.id);
      expect(new Set(ids).size, `${p.id} has duplicate model IDs`).toBe(ids.length);
    }
  });

  it('openai has 5 models', () => {
    const p = PRESET_PROVIDERS.find(p => p.id === 'openai')!;
    expect(p.models.length).toBe(5);
  });

  it('google has openai endpoint', () => {
    const p = PRESET_PROVIDERS.find(p => p.id === 'google')!;
    const hasOpenai = p.endpoints?.some(ep => ep.type === 'openai');
    expect(hasOpenai).toBe(true);
  });

  it('authMode is valid for all providers', () => {
    for (const p of PRESET_PROVIDERS) {
      expect(p.authMode).toMatch(/^(api_key|oauth|both)$/);
    }
  });
});
