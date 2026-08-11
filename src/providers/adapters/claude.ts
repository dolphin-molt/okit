import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";
import { checkClaudeOAuth } from "../auth";

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

export class ClaudeAdapter extends BaseAdapter {
  readonly id = "claude";
  readonly name = "Claude Code";
  readonly supportedTypes: ProviderType[] = ["anthropic"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    const oauthLoggedIn = await checkClaudeOAuth();
    return { mode: "both", hasApiKey: false, oauthLoggedIn };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.claude;
    if (sel?.providerId && sel?.modelId) return sel;
    // Fallback to legacy claude config
    if (config.claude?.name && config.claude?.model) {
      return { providerId: config.claude.name.toLowerCase(), modelId: config.claude.model };
    }
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);
    // "Official" is determined by the base URL only — NOT by whether an API key
    // is bound. A user may have set a key on the Anthropic preset; switching
    // back to it must still clear the custom-routing fields (BASE_URL, MODEL,
    // AUTH_TOKEN, DEFAULT_*_MODEL) so Claude Code resumes its native behavior.
    // If a key is present on the official preset we keep it as ANTHROPIC_API_KEY
    // (the field Claude Code reads for native key auth), separate from the
    // ANTHROPIC_AUTH_TOKEN used by third-party gateways.
    const isOfficial = provider.baseUrl === "https://api.anthropic.com";

    await fs.ensureDir(path.dirname(CLAUDE_SETTINGS_PATH));
    let data: Record<string, any> = {};
    if (await fs.pathExists(CLAUDE_SETTINGS_PATH)) {
      const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    const env = (typeof data.env === "object" && data.env) ? { ...data.env } : {};

    if (isOfficial) {
      // Clear all custom-routing fields so the CLI uses its native OAuth/defaults.
      delete env.ANTHROPIC_BASE_URL;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
      // A key bound to the official preset is kept as the native API key field.
      if (apiKey) {
        env.ANTHROPIC_API_KEY = apiKey;
      } else {
        delete env.ANTHROPIC_API_KEY;
      }
    } else {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
      // Align with Claude Code's model resolution: ANTHROPIC_MODEL is the primary,
      // and the three DEFAULT_*_MODEL keys let custom providers map every tier
      // (haiku/sonnet/opus) to the same backing model so the CLI never 404s when
      // it falls back to a smaller variant. Mirrors cc-switch live.rs behavior.
      env.ANTHROPIC_MODEL = modelId;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelId;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = modelId;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = modelId;
      if (apiKey) {
        env.ANTHROPIC_AUTH_TOKEN = apiKey;
      } else {
        delete env.ANTHROPIC_AUTH_TOKEN;
      }
      // Third-party gateways must not carry a leftover official API key.
      delete env.ANTHROPIC_API_KEY;
    }

    if (Object.keys(env).length === 0) delete data.env;
    else data.env = env;

    await fs.writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(data, null, 2));

    // Save selection to both new and legacy paths
    await updateUserConfig({
      providers: { claude: { providerId: provider.id, modelId } },
      claude: { name: provider.name, model: modelId },
    } as any);
  }
}
