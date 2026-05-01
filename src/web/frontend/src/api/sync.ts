import { api } from './client';

export async function pushSync(): Promise<{ success: boolean; message: string; secrets?: number; platform?: string }> {
  return api('/api/sync/push', { method: 'POST' });
}

export async function pullSync(): Promise<{ success: boolean; message: string; added: number; updated: number; providers?: number; total: number }> {
  return api('/api/sync/pull', { method: 'POST' });
}

export async function getSyncStatus(): Promise<{ machineId: string | null; lastSyncAt: string | null; platformId: string | null; hasPassword: boolean }> {
  return api('/api/sync/status');
}

export async function exportSyncCode(password?: string): Promise<{ success: boolean; code: string; platform: string; secrets: number }> {
  return api('/api/sync/code/export', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function importSyncCode(code: string, password: string): Promise<{ success: boolean; platform: string; secrets: number }> {
  return api('/api/sync/code/import', {
    method: 'POST',
    body: JSON.stringify({ code, password }),
  });
}
