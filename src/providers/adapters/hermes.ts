import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const HERMES_CONFIG_PATH = path.join(os.homedir(), ".hermes", "config.json");

export class HermesAdapter extends BaseAdapter {
  readonly id = "hermes";
  readonly name = "Hermes";
  readonly supportedTypes: ProviderType[] = ["anthropic", "openai", "google"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.hermes;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    await fs.ensureDir(path.dirname(HERMES_CONFIG_PATH));
    let data: Record<string, any> = {};
    if (await fs.pathExists(HERMES_CONFIG_PATH)) {
      const content = await fs.readFile(HERMES_CONFIG_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    if (!data.models) data.models = {};
    if (!data.models.providers) data.models.providers = [];

    const providers = data.models.providers as Record<string, any>[];
    let found = providers.find((p: any) => p.id === provider.id);
    if (!found) {
      found = { id: provider.id, name: provider.name, type: provider.type, baseUrl: provider.baseUrl };
      providers.push(found);
    }
    if (apiKey) {
      found.apiKey = apiKey;
    }
    found.models = provider.models.map(m => ({
      id: m.id,
      name: m.name || m.id,
      capabilities: m.capabilities || [],
    }));

    if (!data.agents) data.agents = {};
    if (!data.agents.default) data.agents.default = {};
    data.agents.default.model = modelId;
    data.agents.default.provider = provider.id;

    await fs.writeFile(HERMES_CONFIG_PATH, JSON.stringify(data, null, 2));
    await updateUserConfig({
      providers: { hermes: { providerId: provider.id, modelId } },
    } as any);
  }
}
