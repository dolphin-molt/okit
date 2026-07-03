import { describe, expect, it } from 'vitest';
import { flattenVaultAliasOptions, formatVaultReference } from '../src/web/frontend/src/lib/vaultRefs';

describe('vault reference helpers', () => {
  it('keeps default aliases compact and preserves custom aliases explicitly', () => {
    expect(formatVaultReference('OPENAI_API_KEY', 'default')).toBe('OPENAI_API_KEY');
    expect(formatVaultReference('MINIMAX_READO_KEY', 'MINIAX READO项目密钥')).toBe('MINIMAX_READO_KEY/MINIAX READO项目密钥');
  });

  it('flattens every alias as a selectable vault reference', () => {
    expect(flattenVaultAliasOptions([
      {
        key: 'SERVICE_KEY',
        group: 'AI',
        aliases: [
          { alias: 'default', masked: 'sk-***123' },
          { alias: 'team', masked: 'sk-***456' },
        ],
      },
    ])).toEqual([
      expect.objectContaining({ reference: 'SERVICE_KEY', key: 'SERVICE_KEY', alias: 'default' }),
      expect.objectContaining({ reference: 'SERVICE_KEY/team', key: 'SERVICE_KEY', alias: 'team' }),
    ]);
  });
});
