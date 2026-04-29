import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";

const GEMINI_DIR = path.join(os.homedir(), ".gemini");

export class GeminiAdapter extends BaseAdapter {
  readonly id = "gemini";
  readonly name = "Gemini CLI";
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

    if (apiKey) {
      await fs.ensureDir(GEMINI_DIR);
      const envPath = path.join(GEMINI_DIR, ".env");
      await fs.writeFile(envPath, `GEMINI_API_KEY=${apiKey}\nGOOGLE_API_KEY=${apiKey}\n`);
    }

    await updateUserConfig({
      providers: { gemini: { providerId: provider.id, modelId } },
    } as any);
  }
}
