import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const ZCODE_CONFIG_PATH = path.join(os.homedir(), ".zcode", "config.json");

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

    await fs.writeFile(ZCODE_CONFIG_PATH, JSON.stringify(data, null, 2));
    await updateUserConfig({
      providers: { zcode: { providerId: provider.id, modelId } },
    } as any);
  }
}
