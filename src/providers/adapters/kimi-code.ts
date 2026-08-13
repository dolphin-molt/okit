import fs from "fs-extra";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { BaseAdapter } from "./base";
import { AgentSelection, AuthStatus, Provider, ProviderType } from "../types";
import { loadUserConfig, updateUserConfig } from "../../config/user";
import { atomicWrite, atomicWriteJSON } from "../../utils/atomicWrite";

const KIMI_CODE_DIR = path.join(os.homedir(), ".kimi-code");
const KIMI_CODE_CONFIG_PATH = path.join(KIMI_CODE_DIR, "config.toml");

export class KimiCodeAdapter extends BaseAdapter {
  readonly id = "kimi-code";
  readonly name = "Kimi Code";
  readonly supportedTypes: ProviderType[] = ["openai"];

  async detectOAuthStatus(): Promise<AuthStatus> {
    return { mode: "api_key", hasApiKey: false };
  }

  async getCurrentConfig(): Promise<AgentSelection | null> {
    const config = await loadUserConfig();
    const sel = (config as any).providers?.["kimi-code"];
    if (sel?.providerId && sel?.modelId) return sel;
    return null;
  }

  async applyConfig(provider: Provider, modelId: string): Promise<void> {
    const apiKey = await this.resolveApiKey(provider);

    await fs.ensureDir(KIMI_CODE_DIR);
    let toml = "";
    if (await fs.pathExists(KIMI_CODE_CONFIG_PATH)) {
      toml = await fs.readFile(KIMI_CODE_CONFIG_PATH, "utf-8");
    }

    const providerId = getKimiCodeProviderId(provider);
    const openAIEndpoint = getProviderEndpoint(provider, "openai");

    toml = upsertTopLevelTomlKey(toml, "model", tomlString(modelId));
    toml = upsertTopLevelTomlKey(toml, "model_provider", tomlString(providerId));

    if (providerId !== "kimi") {
      const envKey = getKimiCodeEnvKey(provider);
      const wireApi = openAIEndpoint.protocol === "responses" ? "responses" : "chat";
      toml = upsertTomlTable(toml, `model_providers.${providerId}`, [
        `name = ${tomlString(provider.name)}`,
        `base_url = ${tomlString(openAIEndpoint.baseUrl)}`,
        `env_key = ${tomlString(envKey)}`,
        `wire_api = ${tomlString(wireApi)}`,
      ]);
      if (apiKey) await upsertEnvFile(path.join(KIMI_CODE_DIR, ".env"), envKey, apiKey);
    } else if (apiKey) {
      await upsertEnvFile(path.join(KIMI_CODE_DIR, ".env"), "MOONSHOT_API_KEY", apiKey);
    }
    await atomicWrite(KIMI_CODE_CONFIG_PATH, toml);

    await updateUserConfig({
      providers: { "kimi-code": { providerId: provider.id, modelId } },
    } as any);
  }
}

function getProviderEndpoint(provider: Provider, type: ProviderType) {
  const endpoints = provider.endpoints || [{ type: provider.type, baseUrl: provider.baseUrl }];
  const endpoint = endpoints.find(ep => ep.type === type);
  if (!endpoint?.baseUrl) throw new Error(`${provider.name} 缺少 ${type} endpoint`);
  return endpoint;
}

function getKimiCodeProviderId(provider: Provider): string {
  if (provider.id === "kimi-coding" || provider.id === "moonshot") return "kimi";
  return `okit-${sanitizeTomlKey(provider.id)}`;
}

function getKimiCodeEnvKey(provider: Provider): string {
  return `OKIT_KIMI_CODE_${provider.id.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

function sanitizeTomlKey(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function upsertTopLevelTomlKey(toml: string, key: string, value: string): string {
  const lines = toml.split("\n");
  let tableStart = lines.findIndex(line => line.trim().startsWith("["));
  if (tableStart === -1) tableStart = lines.length;

  for (let i = 0; i < tableStart; i++) {
    if (new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(lines[i])) {
      lines[i] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }

  lines.splice(tableStart, 0, `${key} = ${value}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function upsertTomlTable(toml: string, tableName: string, lines: string[]): string {
  const header = `[${tableName}]`;
  const tableLines = [header, ...lines];
  const sourceLines = toml.split("\n");
  const headerRegex = new RegExp(`^\\s*\\[${escapeRegex(tableName)}\\]\\s*(?:#.*)?$`);
  const tableStart = sourceLines.findIndex(line => headerRegex.test(line));

  if (tableStart >= 0) {
    let tableEnd = tableStart + 1;
    while (tableEnd < sourceLines.length && !/^\s*\[/.test(sourceLines[tableEnd])) {
      tableEnd++;
    }

    const before = sourceLines.slice(0, tableStart);
    const after = sourceLines.slice(tableEnd);
    while (before.length && before[before.length - 1].trim() === "") before.pop();
    while (after.length && after[0].trim() === "") after.shift();

    return [
      ...before,
      ...(before.length ? [""] : []),
      ...tableLines,
      ...(after.length ? ["", ...after] : [""]),
    ].join("\n");
  }

  return `${toml.trimEnd()}\n\n${tableLines.join("\n")}\n`;
}

function tomlString(value: string): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeRegex(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function upsertEnvFile(envPath: string, key: string, value: string): Promise<void> {
  let content = "";
  if (await fs.pathExists(envPath)) {
    content = await fs.readFile(envPath, "utf-8");
  }

  const line = `export ${key}=${shellQuote(value)}`;
  const regex = new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(key)}=.*$`, "m");
  content = regex.test(content)
    ? content.replace(regex, line)
    : `${content.trimEnd()}\n${line}\n`;

  await atomicWrite(envPath, content.trimStart());
  await syncMacGuiEnv(key, value);
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function syncMacGuiEnv(key: string, value: string): Promise<void> {
  if (os.platform() !== "darwin") return;

  await new Promise<void>((resolve) => {
    execFile("/bin/launchctl", ["setenv", key, value], (err) => {
      if (err) console.warn(`[kimi-code] launchctl setenv ${key} failed: ${err.message}`);
      resolve();
    });
  });
}
