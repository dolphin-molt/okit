import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const WORKBUDDY_DIR = path.join(os.homedir(), ".workbuddy");
const WORKBUDDY_MODELS_PATH = path.join(WORKBUDDY_DIR, "models.json");

export class WorkBuddyAdapter extends BaseAdapter {
  readonly id = "workbuddy";
  readonly name = "WorkBuddy";
  readonly supportedTypes: ProviderType[] = ["anthropic", "openai", "google"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.workbuddy;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    await fs.ensureDir(WORKBUDDY_DIR);
    let data: Record<string, any> = {};
    if (await fs.pathExists(WORKBUDDY_MODELS_PATH)) {
      const content = await fs.readFile(WORKBUDDY_MODELS_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    // WorkBuddy models.json format: { models: [...], availableModels: [...] }
    if (!Array.isArray(data.models)) data.models = [];

    // Build the chat completions URL from provider baseUrl
    const baseUrl = provider.baseUrl.replace(/\/$/, "");
    const chatUrl = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    // Upsert model entry
    const model = provider.models.find(m => m.id === modelId);
    let entry = data.models.find((m: any) => m.id === modelId);
    if (!entry) {
      entry = {
        id: modelId,
        name: model?.name || modelId,
        vendor: provider.name,
        url: chatUrl,
      };
      data.models.push(entry);
    } else {
      entry.name = model?.name || entry.name;
      entry.vendor = provider.name;
      entry.url = chatUrl;
    }
    if (apiKey) {
      entry.apiKey = apiKey;
    }

    // Update availableModels to include this model
    if (!Array.isArray(data.availableModels)) data.availableModels = [];
    if (!data.availableModels.includes(modelId)) {
      data.availableModels.push(modelId);
    }

    await fs.writeFile(WORKBUDDY_MODELS_PATH, JSON.stringify(data, null, 2));
    await updateUserConfig({
      providers: { workbuddy: { providerId: provider.id, modelId } },
    } as any);
  }
}
