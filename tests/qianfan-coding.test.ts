import { describe, expect, it } from 'vitest';

import {
  isQianfanCodingEndpoint,
  qianfanCodingErrorCode,
  qianfanCodingErrorMessage,
  qianfanCodingModels,
} from '../src/web/api/qianfan-coding.js';

describe('Qianfan Coding Plan endpoint helpers', () => {
  it('recognizes only the dedicated OpenAI-compatible coding base URL', () => {
    expect(isQianfanCodingEndpoint('https://qianfan.baidubce.com/v2/coding')).toBe(true);
    expect(isQianfanCodingEndpoint('https://qianfan.baidubce.com/v2/coding/')).toBe(true);
    expect(isQianfanCodingEndpoint('https://qianfan.baidubce.com/v2/tokenplan/personal')).toBe(true);
    expect(isQianfanCodingEndpoint('https://qianfan.baidubce.com/v2')).toBe(false);
  });

  it('extracts the provider error code without exposing credentials', () => {
    expect(qianfanCodingErrorCode(JSON.stringify({ error: { code: 'coding_plan_api_key_required' } })))
      .toBe('coding_plan_api_key_required');
    expect(qianfanCodingErrorCode('not-json')).toBe('');
  });

  it('explains the dedicated-key failure instead of saying the key is generically invalid', () => {
    expect(qianfanCodingErrorMessage('coding_plan_api_key_required'))
      .toContain('Coding Plan 专属 API Key');
    expect(qianfanCodingErrorMessage('token_plan_person_api_key_required'))
      .toContain('Token Plan 专属 API Key');
    expect(qianfanCodingErrorMessage('unknown-code')).toBe('');
  });

  it('keeps the documented Coding Plan model fallback list stable', () => {
    const models = qianfanCodingModels();
    expect(models.map(model => model.id)).toContain('qianfan-code-latest');
    expect(models.every(model => model.name === model.id)).toBe(true);
  });
});
