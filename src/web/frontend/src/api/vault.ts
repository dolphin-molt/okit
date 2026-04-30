import { api, apiRaw } from './client';

export interface VaultSecret {
  key: string;
  aliases: { alias: string; masked: string; group?: string; updatedAt: string }[];
  group?: string;
  expiresAt?: string;
  bindings?: { envName: string; key: string; file: string }[];
  projects?: { name: string; path: string }[];
}

export async function listVault(): Promise<{ secrets: VaultSecret[] }> {
  return api('/api/vault');
}

export async function getVaultValue(key: string, alias = 'default'): Promise<{ value: string }> {
  return api(`/api/vault/value?key=${encodeURIComponent(key)}&alias=${encodeURIComponent(alias)}`);
}

export async function setVault(data: {
  key: string;
  alias: string;
  value: string;
  group?: string;
  originalKey?: string;
  originalAlias?: string;
}): Promise<{ success: boolean }> {
  return api('/api/vault', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteVault(key: string, alias = 'default'): Promise<{ success: boolean }> {
  return api('/api/vault', {
    method: 'DELETE',
    body: JSON.stringify({ key, alias }),
  });
}

export async function exportVault(): Promise<Blob> {
  const res = await apiRaw('/api/vault/export');
  return res.blob();
}

export async function importVault(data: { secrets: any[] }): Promise<{ success: boolean; imported: number; skipped: number }> {
  return api('/api/vault/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function syncToProject(keys: { key: string; alias: string }[], projectPath: string): Promise<{ synced: number; failed: number }> {
  return api('/api/vault/sync-to-project', {
    method: 'POST',
    body: JSON.stringify({ keys, projectPath }),
  });
}

export async function browseDirs(dirPath: string): Promise<{
  currentPath: string;
  parentPath: string;
  dirs: { name: string; path: string }[];
}> {
  return api(`/api/vault/browse-dirs?path=${encodeURIComponent(dirPath)}`);
}

export async function checkKeyImpact(key: string): Promise<{ projects: string[] }> {
  return api(`/api/vault/impact?key=${encodeURIComponent(key)}`);
}
