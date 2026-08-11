import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const GEMINI_DIR = path.join(os.homedir(), ".gemini");

export class GeminiAdapter extends BaseAdapter {
  readonly id = "gemini";
  readonly name = "Gemini";
  readonly supportedTypes: ProviderType[] = ["google"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.gemini;
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);
    const isOfficialGoogle = provider.baseUrl === "https://generativelanguage.googleapis.com";

    await fs.ensureDir(GEMINI_DIR);
    const envPath = path.join(GEMINI_DIR, ".env");

    if (apiKey) {
      // API-key mode: write key + model + (for non-official gateways) the base URL.
      // GEMINI_MODEL is required — without it Gemini CLI keeps the previous model.
      const lines = [
        `GEMINI_API_KEY=${apiKey}`,
        `GOOGLE_API_KEY=${apiKey}`,
        `GEMINI_MODEL=${modelId}`,
      ];
      if (!isOfficialGoogle) {
        lines.push(`GOOGLE_GEMINI_BASE_URL=${provider.baseUrl}`);
      }
      await fs.writeFile(envPath, lines.join("\n") + "\n");
    } else if (isOfficialGoogle) {
      // OAuth mode for official Google: clear any stale API key so Gemini CLI
      // falls back to its own OAuth login. Mirrors Claude's official-clear path.
      // (settings.json's security.auth.selectedType is left for the CLI to manage.)
      await fs.writeFile(envPath, "");
    }

    await updateUserConfig({
      providers: { gemini: { providerId: provider.id, modelId } },
    } as any);
  }
}
