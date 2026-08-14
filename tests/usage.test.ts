import { describe, expect, it } from 'vitest';

import { parseOpenCodeGoUsage, parseQianfanTokenPlanUsage, parseXiaomiTokenPlanUsage } from '../src/web/api/usage.js';

describe('OpenCode Go usage parser', () => {
  it('maps the Go page rolling, weekly, and monthly windows', () => {
    expect(parseOpenCodeGoUsage({
      rollingUsage: { usagePercent: 12, resetInSec: 300 },
      weeklyUsage: { usagePercent: 34, resetInSec: 3600 },
      monthlyUsage: { usagePercent: 56, resetInSec: 7200 },
    })?.windows.map((window) => ({ label: window.label, usedPercent: window.usedPercent })))
      .toEqual([
        { label: '5h', usedPercent: 12 },
        { label: 'weekly', usedPercent: 34 },
        { label: 'monthly', usedPercent: 56 },
      ]);
  });
});

describe('MiMo Token Plan usage parser', () => {
  it('combines the total and compensation credit buckets', () => {
    const result = parseXiaomiTokenPlanUsage({
      code: 0,
      data: {
        usage: {
          items: [
            { name: 'plan_total_token', used: 125_000_000, limit: 1_000_000_000 },
            { name: 'compensation_total_token', used: 5_000_000, limit: 10_000_000 },
            { name: 'unrelated_bucket', used: 999, limit: 999 },
          ],
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.windows?.[0]).toMatchObject({
      usedPercent: 12.9,
      usedCredits: 130,
      limitCredits: 1010,
      remainingCredits: 880,
      unit: 'M Credits',
      isPrepaid: true,
    });
  });

  it('does not turn an empty console response into a zero balance', () => {
    expect(parseXiaomiTokenPlanUsage({ code: 0, data: { usage: { items: [] } } }))
      .toEqual({ error: 'MiMo 接口暂未返回 Token Plan 额度' });
  });
});

describe('Qianfan personal Token Plan usage parser', () => {
  it('maps total, used, remaining, and expiry without exposing the API key', () => {
    const result = parseQianfanTokenPlanUsage({
      success: true,
      result: {
        items: [{
          apiKey: 'secret-value',
          totalTokens: 10_000_000,
          usedTokens: 41_741,
          expiresAt: '2026-09-10T05:30:01Z',
        }],
      },
    });

    expect(result.windows?.[0]).toMatchObject({
      usedPercent: 0.4,
      usedCredits: 0.0417,
      limitCredits: 10,
      remainingCredits: 9.9583,
      unit: 'M Tokens',
      isPrepaid: true,
      resetAt: '2026-09-10T05:30:01.000Z',
    });
  });
});
