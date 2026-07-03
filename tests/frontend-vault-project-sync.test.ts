import { describe, expect, it } from 'vitest';
import { buildProjectSyncKeys, getProjectSyncFeedback } from '../src/web/frontend/src/lib/vaultProjectSync';

describe('buildProjectSyncKeys', () => {
  it('preserves the selected alias when syncing a vault key to a project', () => {
    expect(buildProjectSyncKeys('MINIMAX_READO_KEY', 'MINIAX READO项目密钥')).toEqual([
      { key: 'MINIMAX_READO_KEY', alias: 'MINIAX READO项目密钥' },
    ]);
  });

  it('treats a zero-synced failed result as an error instead of success', () => {
    expect(getProjectSyncFeedback({ synced: 0, failed: 1 })).toEqual({
      tone: 'error',
      key: 'vault.syncFail',
      params: undefined,
    });
  });
});
