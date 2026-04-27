import { api } from './client';

export interface AgentConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyVaultKey: string;
}

export interface PlatformConfig {
  enabled: boolean;
  [key: string]: any;
}

export interface Settings {
  sync: {
    autoSync: boolean;
    platforms: Record<string, PlatformConfig>;
  };
  agent: AgentConfig;
}

export async function getSettings(): Promise<Settings> {
  return api('/api/settings');
}

export async function updateSettings(data: Partial<Settings>): Promise<{ ok: boolean }> {
  return api('/api/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function testPlatform(platform: string): Promise<{ success: boolean; message: string }> {
  return api('/api/settings/test', {
    method: 'POST',
    body: JSON.stringify({ platform }),
  });
}

export async function testAgent(): Promise<{ success: boolean; message: string }> {
  return api('/api/settings/test-agent', { method: 'POST' });
}

export async function getOnboarding(): Promise<any> {
  return api('/api/settings/onboarding');
}

export async function dismissOnboarding(): Promise<any> {
  return api('/api/settings/onboarding/dismiss', { method: 'POST' });
}

export async function resetOnboarding(): Promise<any> {
  return api('/api/settings/onboarding/reset', { method: 'POST' });
}

export async function getPresets(): Promise<any> {
  return api('/api/settings/presets');
}
