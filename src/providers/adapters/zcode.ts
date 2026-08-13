import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";
import { atomicWrite, atomicWriteJSON } from "../../utils/atomicWrite";

const ZCODE_CONFIG_PATH = path.join(os.homedir(), ".zcode", "config.json");

// Map OKIT protocol type to the agent's `api` field. ZCode shares OpenClaw's
// config lineage (object-keyed providers, agents.defaults.model object).
function apiProtocolFor(type: ProviderType): string {
  switch (type) {
    case "anthropic": return "anthropic";
    case "google": return "google-generative-ai";
    case "openai":
    default: return "openai-completions";
  }
}

export class ZCodeAdapter extends BaseAdapter {
  readonly id = "zcode";
  readonly name = "ZCode";
  readonly supportedTypes: ProviderType[] = ["anthropic", "openai", "google"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.zcode;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    await fs.ensureDir(path.dirname(ZCODE_CONFIG_PATH));
    let data: Record<string, any> = {};
    if (await fs.pathExists(ZCODE_CONFIG_PATH)) {
      const content = await fs.readFile(ZCODE_CONFIG_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    if (typeof data.models !== "object" || data.models === null) data.models = {};
    if (!data.models.mode) data.models.mode = "merge";
    if (typeof data.models.providers !== "object" || data.models.providers === null) {
      data.models.providers = {};
    }

    const providerEntry: Record<string, any> = {
      baseUrl: provider.baseUrl,
      api: apiProtocolFor(provider.type),
      models: provider.models.map(m => ({ id: m.id, name: m.name || m.id })),
    };
    if (apiKey) providerEntry.apiKey = apiKey;
    data.models.providers[provider.id] = providerEntry;

    if (typeof data.agents !== "object" || data.agents === null) data.agents = {};
    if (typeof data.agents.defaults !== "object" || data.agents.defaults === null) {
      data.agents.defaults = {};
    }
    data.agents.defaults.model = { primary: `${provider.id}/${modelId}`, fallbacks: [] };

    await atomicWriteJSON(ZCODE_CONFIG_PATH, data);
    await updateUserConfig({
      providers: { zcode: { providerId: provider.id, modelId } },
    } as any);
  }
}
