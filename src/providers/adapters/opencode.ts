import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const OPENCODE_DIR = path.join(os.homedir(), ".opencode");

export class OpenCodeAdapter extends BaseAdapter {
  readonly id = "opencode";
  readonly name = "OpenCode";
  readonly supportedTypes: ProviderType[] = ["anthropic", "openai", "google"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.opencode;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    await fs.ensureDir(OPENCODE_DIR);
    const configPath = path.join(OPENCODE_DIR, "config.json");

    let data: Record<string, any> = {};
    if (await fs.pathExists(configPath)) {
      const content = await fs.readFile(configPath, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    data.provider = mapProviderType(provider.type);
    data.model = modelId;
    if (apiKey) {
      data.apiKey = apiKey;
    }
    if (provider.baseUrl) {
      data.baseUrl = provider.baseUrl;
    }

    await fs.writeFile(configPath, JSON.stringify(data, null, 2));
    await updateUserConfig({
      providers: { opencode: { providerId: provider.id, modelId } },
    } as any);
  }
}

function mapProviderType(type: string): string {
  switch (type) {
    case "anthropic": return "anthropic";
    case "openai": return "openai";
    case "google": return "google";
    default: return type;
  }
}
