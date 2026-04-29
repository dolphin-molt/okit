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
    const isOfficial = provider.baseUrl === "https://api.anthropic.com" && !apiKey;

    await fs.ensureDir(path.dirname(CLAUDE_SETTINGS_PATH));
    let data: Record<string, any> = {};
    if (await fs.pathExists(CLAUDE_SETTINGS_PATH)) {
      const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    }

    const env = (typeof data.env === "object" && data.env) ? { ...data.env } : {};

    if (isOfficial) {
      delete env.ANTHROPIC_BASE_URL;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_MODEL;
    } else {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
      env.ANTHROPIC_MODEL = modelId;
      if (apiKey) {
        env.ANTHROPIC_AUTH_TOKEN = apiKey;
      } else {
        delete env.ANTHROPIC_AUTH_TOKEN;
      }
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
