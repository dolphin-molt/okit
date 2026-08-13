import fs from "fs-extra";
import path from "path";
import os from "os";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";
import { atomicWrite, atomicWriteJSON } from "../../utils/atomicWrite";

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
    const settingsPath = path.join(GEMINI_DIR, "settings.json");

    if (apiKey) {
      // API-key mode: write GEMINI_API_KEY (NOT GOOGLE_API_KEY — cc-switch writes
      // only GEMINI_API_KEY; GOOGLE_API_KEY can collide with unrelated global
      // creds) + model + (for non-official gateways) the base URL.
      const lines = [
        `GEMINI_API_KEY=${apiKey}`,
        `GEMINI_MODEL=${modelId}`,
      ];
      if (!isOfficialGoogle) {
        lines.push(`GOOGLE_GEMINI_BASE_URL=${provider.baseUrl}`);
      }
      await atomicWrite(envPath, lines.join("\n") + "\n");
      await writeGeminiSelectedType(settingsPath, "gemini-api-key");
    } else if (isOfficialGoogle) {
      // OAuth mode for official Google: clear any stale API key so Gemini CLI
      // falls back to its own OAuth login. selectedType = oauth-personal.
      await atomicWrite(envPath, "");
      await writeGeminiSelectedType(settingsPath, "oauth-personal");
    }

    await updateUserConfig({
      providers: { gemini: { providerId: provider.id, modelId } },
    } as any);
  }
}

// Merge `security.auth.selectedType` into ~/.gemini/settings.json without
// disturbing other fields (mcpServers, etc.). Mirrors cc-switch's
// update_selected_type. selectedType values: "gemini-api-key" (third-party or
// API-key mode) or "oauth-personal" (Google Official OAuth).
async function writeGeminiSelectedType(settingsPath: string, selectedType: string): Promise<void> {
  let data: Record<string, any> = {};
  if (await fs.pathExists(settingsPath)) {
    try {
      const content = await fs.readFile(settingsPath, "utf-8");
      data = content.trim() ? JSON.parse(content) : {};
    } catch {
      data = {};
    }
  }
  if (typeof data.security !== "object" || data.security === null) data.security = {};
  if (typeof data.security.auth !== "object" || data.security.auth === null) data.security.auth = {};
  data.security.auth.selectedType = selectedType;
  await atomicWriteJSON(settingsPath, data);
}
