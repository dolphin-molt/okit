import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");

export class OpenClawAdapter extends BaseAdapter {
  readonly id = "openclaw";
  readonly name = "OpenClaw";
  readonly supportedTypes: ProviderType[] = ["anthropic", "openai", "google"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.openclaw;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    await fs.ensureDir(path.dirname(OPENCLAW_CONFIG_PATH));
    let data: Record<string, any> = {};
    if (await fs.pathExists(OPENCLAW_CONFIG_PATH)) {
      const content = await fs.readFile(OPENCLAW_CONFIG_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    // Update models.providers
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

    // Update agents default
    if (!data.agents) data.agents = {};
    if (!data.agents.default) data.agents.default = {};
    data.agents.default.model = modelId;
    data.agents.default.provider = provider.id;

    await fs.writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(data, null, 2));
    await updateUserConfig({
      providers: { openclaw: { providerId: provider.id, modelId } },
    } as any);
  }
}
