// API protocol compatibility
export type ProviderType = 'anthropic' | 'openai' | 'google';

// A provider (platform) that offers AI models
export interface ProviderEndpoint {
  type: ProviderType;
  baseUrl: string;
}

export interface Provider {
  id: string;              // unique slug (e.g. "volcengine")
  name: string;            // display name (e.g. "火山引擎")
  type: ProviderType;      // primary API protocol
  baseUrl: string;         // primary API endpoint
  endpoints?: ProviderEndpoint[]; // multi-protocol endpoints
  vaultKey?: string;       // reference to Vault key for API key
  authMode: 'api_key' | 'oauth' | 'both';
  models: ProviderModel[];
}

export interface ProviderModel {
  id: string;              // model identifier (e.g. "glm-4.7")
  name?: string;           // display name (e.g. "GLM-4.7")
  capabilities?: string[]; // ["chat", "code", "vision"]
}

// Runtime auth status (computed, not persisted)
export interface AuthStatus {
  mode: 'api_key' | 'oauth' | 'both' | 'none';
  hasApiKey: boolean;
  oauthLoggedIn?: boolean;
}

// Per-agent current selection, stored in user.json
export interface AgentSelection {
  providerId: string;
  modelId: string;
}

// Adapter interface each agent implements
export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly supportedTypes: ProviderType[];
  detectOAuthStatus(): Promise<AuthStatus>;
  getCurrentConfig(): Promise<AgentSelection | null>;
  applyConfig(provider: Provider, modelId: string): Promise<void>;
  resolveApiKey(provider: Provider): Promise<string | undefined>;
}

// Stored file format for providers.json
export interface ProvidersData {
  providers: Provider[];
}
