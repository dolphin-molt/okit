import { describe, expect, it } from 'vitest';
import { getAutoCreatePlatformFields } from '../src/web/frontend/src/components/shared/autoCreateFormState';

const platform = (id: string, keyHint: string, groupHint: string) => ({
  id,
  label: id,
  keyHint,
  groupHint,
  mode: 'browser' as const,
});

describe('auto-create form platform state', () => {
  it('resets the key name and group baseline when switching providers', () => {
    const groups = ['MiniMax · 国内', 'OpenAI'];
    const minimax = getAutoCreatePlatformFields(platform('minimax', 'MINIMAX_API_KEY', 'MiniMax · 国内'), groups);
    const openai = getAutoCreatePlatformFields(platform('openai', 'OPENAI_API_KEY', 'OpenAI'), groups);

    expect(minimax).toEqual({ key: 'MINIMAX_API_KEY', group: 'MiniMax · 国内', groupCustom: '' });
    expect(openai).toEqual({ key: 'OPENAI_API_KEY', group: 'OpenAI', groupCustom: '' });
    expect(openai.key).not.toContain('MINIMAX');
    expect(openai.group).not.toContain('MiniMax');
  });

  it('uses a custom group field when the provider group is not in the current list', () => {
    expect(getAutoCreatePlatformFields(platform('new-provider', 'NEW_PROVIDER_KEY', 'New Provider'), [])).toEqual({
      key: 'NEW_PROVIDER_KEY',
      group: '__custom__',
      groupCustom: 'New Provider',
    });
  });
});
