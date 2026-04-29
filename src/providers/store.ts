import fs from "fs-extra";
import path from "path";
import { OKIT_DIR } from "../config/registry";
import { Provider, ProvidersData } from "./types";
import { PRESET_PROVIDERS } from "./presets";

const PROVIDERS_PATH = path.join(OKIT_DIR, "providers.json");

export async function loadProviders(): Promise<Provider[]> {
  if (!(await fs.pathExists(PROVIDERS_PATH))) {
    await saveProviders(PRESET_PROVIDERS as Provider[]);
    return [...PRESET_PROVIDERS] as Provider[];
  }
  try {
    const content = await fs.readFile(PROVIDERS_PATH, "utf-8");
    const data: ProvidersData = JSON.parse(content);
    if (!Array.isArray(data.providers)) return [];
    const providers = data.providers.filter(isValidProvider);

    // Merge new presets: add missing ones, update name changes for existing presets
    const existingIds = new Set(providers.map(p => p.id));
    let changed = false;
    for (const preset of PRESET_PROVIDERS as Provider[]) {
      const existing = providers.find(p => p.id === preset.id);
      if (!existing) {
        providers.push(preset);
        changed = true;
      } else if (existing.name !== preset.name) {
        existing.name = preset.name;
        changed = true;
      }
    }
    if (changed) await saveProviders(providers);

    return providers;
  } catch {
    return [];
  }
}

export async function saveProviders(providers: Provider[]): Promise<void> {
  await fs.ensureDir(OKIT_DIR);
  const data: ProvidersData = { providers };
  await fs.writeFile(PROVIDERS_PATH, JSON.stringify(data, null, 2));
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const providers = await loadProviders();
  return providers.find(p => p.id === id);
}

export async function addProvider(provider: Provider): Promise<void> {
  const providers = await loadProviders();
  const idx = providers.findIndex(p => p.id === provider.id);
  if (idx >= 0) {
    providers[idx] = provider;
  } else {
    providers.push(provider);
  }
  await saveProviders(providers);
}

export async function deleteProvider(id: string): Promise<boolean> {
  const providers = await loadProviders();
  const idx = providers.findIndex(p => p.id === id);
  if (idx < 0) return false;
  providers.splice(idx, 1);
  await saveProviders(providers);
  return true;
}

function isValidProvider(value: any): value is Provider {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.baseUrl === "string" &&
    Array.isArray(value.models) &&
    value.models.every((m: any) => typeof m.id === "string")
  );
}
