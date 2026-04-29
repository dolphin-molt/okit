import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";
import { checkCodexOAuth } from "../auth";

const CODEX_DIR = path.join(os.homedir(), ".codex");
const CODEX_CONFIG_PATH = path.join(CODEX_DIR, "config.toml");

export class CodexAdapter extends BaseAdapter {
  readonly id = "codex";
  readonly name = "Codex CLI";
  readonly supportedTypes: ProviderType[] = ["openai"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    const oauthLoggedIn = await checkCodexOAuth();
    return { mode: "both", hasApiKey: false, oauthLoggedIn };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.codex;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    // Update config.toml
    await fs.ensureDir(CODEX_DIR);
    let toml = "";
    if (await fs.pathExists(CODEX_CONFIG_PATH)) {
      toml = await fs.readFile(CODEX_CONFIG_PATH, "utf-8");
    }
    toml = setTomlField(toml, "model", modelId);
    if (provider.baseUrl && provider.baseUrl !== "https://api.openai.com/v1") {
      toml = setTomlField(toml, "api_base", provider.baseUrl);
    } else {
      toml = removeTomlField(toml, "api_base");
    }
    await fs.writeFile(CODEX_CONFIG_PATH, toml);

    // Write env file for API key
    if (apiKey) {
      const envPath = path.join(CODEX_DIR, ".env");
      await fs.writeFile(envPath, `OPENAI_API_KEY=${apiKey}\n`);
    }

    await updateUserConfig({
      providers: { codex: { providerId: provider.id, modelId } },
    } as any);
  }
}

function setTomlField(content: string, field: string, value: string): string {
  const regex = new RegExp(`^${field}\\s*=\\s*.*$`, "m");
  const line = `${field} = "${value}"`;
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return content.trimEnd() + "\n" + line + "\n";
}

function removeTomlField(content: string, field: string): string {
  const regex = new RegExp(`^${field}\\s*=\\s*.*\\n?`, "m");
  return content.replace(regex, "");
}
