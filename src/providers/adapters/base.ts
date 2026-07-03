import { AgentAdapter, AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { VaultStore } from "../../vault/store";

export abstract class BaseAdapter implements AgentAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly supportedTypes: ProviderType[];
  abstract detectOAuthStatus(): Promise<AuthStatus>;
  abstract getCurrentConfig(): Promise<AgentSelection | null>;
  abstract applyConfig(provider: Provider, modelId: string): Promise<void>;

  async resolveApiKey(provider: Provider): Promise<string | undefined> {
    if (provider.vaultKey) {
      try {
        const store = new VaultStore();
        const value = await store.get(provider.vaultKey);
        if (value) return value;
        const parsed = VaultStore.parseKeyAlias(provider.vaultKey);
        const resolved = await store.resolve(parsed.key, parsed.alias);
        if (resolved) return resolved;
      } catch {}
    }
    return undefined;
  }
}
