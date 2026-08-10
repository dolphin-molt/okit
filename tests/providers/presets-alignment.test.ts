import { describe, it, expect } from 'vitest';
import { PRESET_PROVIDERS } from '../../src/providers/presets';

describe('PRESET_PROVIDERS alignment', () => {
  const EXPECTED_IDS = [
    'anthropic', 'openai', 'openai-codex', 'google', 'volcengine',
    'zai', 'zai-global', 'glm-coding', 'minimax', 'minimax-global', 'minimax-coding',
    'deepseek', 'moonshot', 'kimi-coding', 'kimi-coding-plan', 'qwen', 'qianfan',
    'qianfan-coding', 'volcengine-coding', 'tencent-coding', 'xai', 'mistral', 'stepfun',
    'xiaomi', 'xiaomi-coding',
    'openrouter', 'ollama', 'litellm',
  ];

  it('has exactly 28 presets', () => {
    expect(PRESET_PROVIDERS.length).toBe(28);
  });

  it('contains all expected provider IDs', () => {
    const ids = PRESET_PROVIDERS.map(p => p.id);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('keeps OpenRouter as the only bundled aggregator', () => {
    const ids = PRESET_PROVIDERS.map(p => p.id);
    expect(ids).toContain('openrouter');
    expect(ids).not.toContain('groq');
    expect(ids).not.toContain('fireworks');
    expect(ids).not.toContain('together');
  });

  it('has no duplicate IDs', () => {
    const ids = PRESET_PROVIDERS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the legacy Kimi Coding ID while using the Kimi product name', () => {
    const kimi = PRESET_PROVIDERS.find(provider => provider.id === 'kimi-coding');
    expect(kimi?.name).toBe('Kimi');
    expect(kimi?.baseUrl).toBe('https://api.moonshot.cn/v1');
    const moonshot = PRESET_PROVIDERS.find(provider => provider.id === 'moonshot');
    expect(moonshot?.name).toBe('Moonshot (Kimi Global)');
    expect(moonshot?.baseUrl).toBe('https://api.moonshot.ai/v1');
  });

  it('multi-endpoint providers have endpoints array', () => {
    const multiEndpoint = [
      'google', 'zai', 'deepseek', 'xiaomi',
      'kimi-coding-plan', 'glm-coding', 'minimax-coding',
      'volcengine-coding', 'tencent-coding', 'xiaomi-coding',
    ];
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

  it('marks Coding and Token Plan endpoints explicitly', () => {
    const codingIds = ['kimi-coding-plan', 'glm-coding', 'volcengine-coding', 'tencent-coding'];
    for (const id of codingIds) {
      const provider = PRESET_PROVIDERS.find(p => p.id === id)!;
      expect(provider.endpoints?.every(endpoint => endpoint.plan === 'coding'), id).toBe(true);
    }
    for (const id of ['minimax-coding', 'xiaomi-coding']) {
      const provider = PRESET_PROVIDERS.find(p => p.id === id)!;
      expect(provider.endpoints?.every(endpoint => endpoint.plan === 'token'), id).toBe(true);
    }
  });

  it('matches the signed-in MiMo Token Plan Base URLs and model list', () => {
    const provider = PRESET_PROVIDERS.find(p => p.id === 'xiaomi-coding')!;
    expect(provider.baseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/v1');
    expect(provider.endpoints).toEqual([
      { type: 'openai', protocol: 'chat', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', plan: 'token' },
      { type: 'anthropic', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic', plan: 'token' },
    ]);
    expect(provider.models.map(model => model.id)).toEqual([
      'mimo-v2.5', 'mimo-v2.5-pro', 'mimo-v2.5-asr', 'mimo-v2.5-tts',
      'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-tts-voicedesign',
    ]);
  });

  it('authMode is valid for all providers', () => {
    for (const p of PRESET_PROVIDERS) {
      expect(p.authMode).toMatch(/^(api_key|oauth|both)$/);
    }
  });
});
