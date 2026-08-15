import { api, apiRaw } from './client';

export interface VaultSecret {
  key: string;
  masked: string;
  desc?: string;
  updatedAt: string;
  group?: string;
  expiresAt?: string;
  bindings?: { envName: string; key: string; file: string }[];
  projects?: { name: string; path: string }[];
}

export interface AutoCreatePlatform {
  id: string;
  label: string;
  keyHint: string;
  groupHint: string;
  mode: 'api' | 'browser';
  reusesExistingCredentialPair?: boolean;
}

export async function listVault(): Promise<{ secrets: VaultSecret[] }> {
  return api('/api/vault/list');
}

export async function getVaultValue(key: string): Promise<{ value: string }> {
  return api(`/api/vault/value?key=${encodeURIComponent(key)}`);
}

export async function setVault(data: {
  key: string;
  value: string;
  desc?: string;
  group?: string;
  originalKey?: string;
}): Promise<{ success: boolean }> {
  return api('/api/vault', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listAutoCreatePlatforms(): Promise<{ platforms: AutoCreatePlatform[] }> {
  return api('/api/vault/auto-create/platforms');
}

export async function deleteVault(key: string): Promise<{ success: boolean }> {
  return api('/api/vault', {
    method: 'DELETE',
    body: JSON.stringify({ key }),
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

export async function checkKeyImpact(key: string): Promise<{ projects: string[] }> {
  return api(`/api/vault/impact?key=${encodeURIComponent(key)}`);
}
