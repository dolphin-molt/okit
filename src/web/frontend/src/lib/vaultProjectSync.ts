export function buildProjectSyncKeys(key: string, alias: string) {
  return [{ key, alias: alias || 'default' }];
}

export function getProjectSyncFeedback(result: { synced: number; failed?: number }) {
  if ((result.failed || 0) > 0 && result.synced === 0) {
    return { tone: 'error' as const, key: 'vault.syncFail', params: undefined };
  }
  return { tone: 'success' as const, key: 'vault.written', params: { n: result.synced } };
}
