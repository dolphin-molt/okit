import { api } from './client';

export interface ProviderModel {
  id: string;
  name?: string;
  capabilities?: string[];
}

export interface ProviderEndpoint {
  type: 'anthropic' | 'openai' | 'google';
  baseUrl: string;
}

export interface Provider {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'google';
  baseUrl: string;
  endpoints?: ProviderEndpoint[];
  vaultKey?: string;
  authMode: 'api_key' | 'oauth' | 'both';
  models: ProviderModel[];
  usedBy?: { id: string; name: string; modelId: string }[];
}

export interface AgentInfo {
  id: string;
  name: string;
  supportedTypes: string[];
  current: { providerId: string; providerName: string; modelId: string } | null;
  compatibleProviders: { id: string; name: string; type: string; models: ProviderModel[] }[];
}

export async function listProviders(): Promise<{ providers: Provider[] }> {
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

export async function getAuthStatus(): Promise<{ statuses: { id: string; name: string; hasApiKey: boolean; oauthLoggedIn: boolean | null; authMode: string }[] }> {
  return api('/api/providers/auth');
}

export async function triggerOAuthLogin(providerId: string): Promise<{ success: boolean; message: string }> {
  return api('/api/providers/auth/login', {
    method: 'POST',
    body: JSON.stringify({ providerId }),
  });
}

export async function fetchModels(providerId: string): Promise<{ success: boolean; models: ProviderModel[]; errors?: { endpoint: string; error: string }[]; kept?: ProviderModel[] }> {
  return api('/api/providers/fetch-models', {
    method: 'POST',
    body: JSON.stringify({ providerId }),
  });
}
