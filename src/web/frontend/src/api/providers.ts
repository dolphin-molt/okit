import { api } from './client';

export interface ProviderModel {
  id: string;
  name?: string;
  capabilities?: string[];
}

export interface ProviderEndpoint {
  type: 'anthropic' | 'openai' | 'google';
  baseUrl: string;
  protocol?: 'chat' | 'responses';
  plan?: 'coding' | 'token' | 'agent' | 'go';
}

export interface Provider {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'google';
  baseUrl: string;
  endpoints?: ProviderEndpoint[];
  vaultKey?: string;
  authVerified?: boolean;
  authVerifiedKey?: string;
  authVerifiedAt?: string;
  authVerifiedEndpointIds?: string[];
  authMode: 'api_key' | 'oauth' | 'both';
  models: ProviderModel[];
  usedBy?: { id: string; name: string; modelId: string }[];
}

export interface PlatformOffering {
  id: string;
  type: string;
  label: string;
  providerId: string;
  endpointIds: string[];
  authMethodIds: string[];
}

export interface PlatformAuthMethod {
  id: string;
  type: string;
  label: string;
  providerId: string;
  credentialRef?: string;
  status?: 'unconfigured' | 'configured' | 'verified' | 'invalid' | 'expired';
  verifiedAt?: string;
  verifiedEndpointId?: string;
}

export interface PlatformEndpoint {
  id: string;
  name: string;
  offeringId: string;
  baseUrl: string;
  protocol: { family: string; mode: string };
  authMethodIds: string[];
  modelDiscovery: { type: string; path?: string; modelIds?: string[]; command?: string };
}

export interface PlatformModel {
  id: string;
  name: string;
  capabilities?: string[];
  availability: {
    offeringId: string;
    endpointIds: string[];
    remoteModelId: string;
    status: string;
    source: string;
    discoveredAt?: string;
  }[];
}

export interface Platform {
  id: string;
  name: string;
  providerIds: string[];
  offerings: PlatformOffering[];
  authMethods: PlatformAuthMethod[];
  endpoints: PlatformEndpoint[];
  models: PlatformModel[];
}

export interface AgentInfo {
  id: string;
  name: string;
  supportedTypes: string[];
  launchType?: 'cli' | 'app';
  canLaunch?: boolean;
  installed?: boolean;
  current: { providerId: string; providerName: string; modelId: string } | null;
  compatibleProviders: { id: string; name: string; type: string; models: ProviderModel[] }[];
}

export async function listProviders(): Promise<{ providers: Provider[]; platforms: Platform[] }> {
  return api('/api/providers');
}

export async function getAdapters(): Promise<{ adapters: AgentInfo[] }> {
  return api('/api/providers/adapters');
}

export async function createProvider(data: Partial<Provider> & { id: string; name: string; type: string; baseUrl: string }): Promise<{ success: boolean; provider: Provider }> {
  return api('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProvider(id: string, data: Partial<Provider>): Promise<{ success: boolean; provider: Provider }> {
  return api(`/api/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteProvider(id: string): Promise<{ success: boolean }> {
  return api(`/api/providers/${id}`, { method: 'DELETE' });
}

export async function switchProvider(agentId: string, providerId: string, modelId: string): Promise<{ success: boolean }> {
  return api('/api/providers/switch', {
    method: 'POST',
    body: JSON.stringify({ agentId, providerId, modelId }),
  });
}

export async function launchAgent(agentId: string): Promise<{ success: boolean; command: string }> {
  return api('/api/providers/launch', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
}

export async function getAuthStatus(): Promise<{ statuses: { id: string; name: string; hasApiKey: boolean; authVerified: boolean; oauthLoggedIn: boolean | null; authMode: string }[] }> {
  return api('/api/providers/auth');
}

export async function triggerOAuthLogin(providerId: string): Promise<{ success: boolean; message: string }> {
  return api('/api/providers/auth/login', {
    method: 'POST',
    body: JSON.stringify({ providerId }),
  });
}

export async function fetchModels(providerId?: string, config?: { endpoints?: ProviderEndpoint[]; vaultKey?: string }): Promise<{ success: boolean; models: ProviderModel[]; errors?: { endpoint: string; error: string }[]; kept?: ProviderModel[] }> {
  return api('/api/providers/fetch-models', {
    method: 'POST',
    body: JSON.stringify({ providerId, ...config }),
  });
}

export interface UsageWindow {
  label: string;
  usedPercent: number | null;
  resetAt: string | null;
  usedCredits?: number;
  limitCredits?: number | null;
  remainingCredits?: number | null;
  isPrepaid?: boolean;
}

export interface UsageResult {
  providerId?: string;
  supported: boolean;
  windows?: UsageWindow[];
  error?: string;
  notice?: string;
  source?: 'live' | 'cli' | 'console';
  raw?: any;
}

export async function getSupportedUsageProviders(): Promise<{ providers: string[] }> {
  return api('/api/usage/supported');
}

export async function getUsage(providerId: string): Promise<UsageResult> {
  return api(`/api/usage/${encodeURIComponent(providerId)}`);
}
