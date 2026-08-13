import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";
import { atomicWrite, atomicWriteJSON } from "../../utils/atomicWrite";

// OpenCode reads ~/.config/opencode/opencode.json (NOT ~/.opencode/config.json).
// The schema is additive: provider is an object keyed by provider id, each entry
// carries the AI SDK npm package + options + models. Mirrors cc-switch's
// opencode_config.rs + OpenCodeProviderConfig. Previous OKIT version wrote a
// flat {provider, model, apiKey, baseUrl} shape that OpenCode never reads.
const OPENCODE_CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "opencode.json");

// Map OKIT's protocol type to the AI SDK package OpenCode loads for it.
function npmPackageFor(type: ProviderType): string {
  switch (type) {
    case "anthropic": return "@ai-sdk/anthropic";
    case "google": return "@ai-sdk/google";
    case "openai":
    default: return "@ai-sdk/openai-compatible";
  }
}

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

    await fs.ensureDir(path.dirname(OPENCODE_CONFIG_PATH));
    let data: Record<string, any> = {};
    if (await fs.pathExists(OPENCODE_CONFIG_PATH)) {
      const content = await fs.readFile(OPENCODE_CONFIG_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    // Ensure provider is an object map (additive mode), not a string.
    if (typeof data.provider !== "object" || data.provider === null) data.provider = {};
    if (!("$schema" in data) && Object.keys(data).length === 0) {
      data.$schema = "https://opencode.ai/config.json";
    }

    const providerEntry: Record<string, any> = {
      npm: npmPackageFor(provider.type),
      name: provider.name,
      options: {
        baseURL: provider.baseUrl,
      },
    };
    if (apiKey) providerEntry.options.apiKey = apiKey;

    // Models: object keyed by model id. Surface the full list so OpenCode can
    // offer all of them; the active one is chosen via the `model` top-level key.
    const modelsMap: Record<string, any> = {};
    for (const m of provider.models) {
      modelsMap[m.id] = { name: m.name || m.id };
    }
    providerEntry.models = modelsMap;

    (data.provider as Record<string, any>)[provider.id] = providerEntry;

    // OpenCode is additive-mode: all configured providers coexist and OpenCode
    // itself picks which one to use (there is no "active provider" concept that
    // OKIT needs to set — mirrors cc-switch where ProviderService::current()
    // returns empty for additive apps). We only ensure this provider + its
    // models are present.

    await atomicWriteJSON(OPENCODE_CONFIG_PATH, data);
    await updateUserConfig({
      providers: { opencode: { providerId: provider.id, modelId } },
    } as any);
  }
}
