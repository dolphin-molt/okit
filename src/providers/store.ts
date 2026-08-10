import fs from "fs-extra";
import path from "path";
import { OKIT_DIR } from "../config/registry";
import { backupImportantData } from "../config/backup";
import { Provider, ProvidersData } from "./types";
import { PRESET_PROVIDERS } from "./presets";

const PROVIDERS_PATH = path.join(OKIT_DIR, "providers.json");
// These used to be bundled presets. Retire them on load as well as removing
// them from the source list so existing OKIT installations match the UI.
const RETIRED_PRESET_PROVIDER_IDS = new Set(["groq", "fireworks", "together"]);
// Apply only this exact built-in endpoint correction. User-customized URLs are
// intentionally left untouched when presets are refreshed.
const PRESET_BASE_URL_MIGRATIONS = new Map([
  ["kimi-coding", { from: "https://api.kimi.com", to: "https://api.moonshot.cn/v1" }],
  ["qianfan-coding", { from: "https://qianfan.baidubce.com/v2/coding", to: "https://qianfan.baidubce.com/v2/tokenplan/personal" }],
  ["xiaomi-coding", { from: "https://token-plan-cn.xiaomimimo.com/v1", to: "https://token-plan-sgp.xiaomimimo.com/v1" }],
]);
const PRESET_ENDPOINT_BASE_URL_MIGRATIONS = new Map([
  ["kimi-coding-plan", { from: "https://api.kimi.com/coding/", to: "https://api.kimi.com/coding" }],
  ["xiaomi-coding", { from: "https://token-plan-cn.xiaomimimo.com/anthropic", to: "https://token-plan-sgp.xiaomimimo.com/anthropic" }],
]);

export async function loadProviders(): Promise<Provider[]> {
  if (!(await fs.pathExists(PROVIDERS_PATH))) {
    await saveProviders(PRESET_PROVIDERS as Provider[]);
    return [...PRESET_PROVIDERS] as Provider[];
  }
  try {
    const content = await fs.readFile(PROVIDERS_PATH, "utf-8");
    const data: ProvidersData = JSON.parse(content);
    if (!Array.isArray(data.providers)) return [];
    const providers = data.providers
      .filter(isValidProvider)
      .filter(provider => !RETIRED_PRESET_PROVIDER_IDS.has(provider.id));

    // Merge new presets: add missing ones, update name changes, and apply
    // narrowly-scoped endpoint migrations for known broken built-in defaults.
    const existingIds = new Set(providers.map(p => p.id));
    let changed = providers.length !== data.providers.length;
    for (const preset of PRESET_PROVIDERS as Provider[]) {
      const existing = providers.find(p => p.id === preset.id);
      if (!existing) {
        providers.push(preset);
        changed = true;
      } else {
        const migration = PRESET_BASE_URL_MIGRATIONS.get(preset.id);
        if (migration) {
          if (existing.baseUrl === migration.from) {
            existing.baseUrl = migration.to;
            changed = true;
          }
          // Model Management reads `endpoints` when it is present. Migrate the
          // same known stale URL there too; otherwise the card looks updated
          // while its connection test still calls the old endpoint.
          if (Array.isArray(existing.endpoints)) {
            let endpointChanged = false;
            existing.endpoints = existing.endpoints.map(endpoint => {
              if (endpoint && endpoint.baseUrl === migration.from) {
                endpointChanged = true;
                return { ...endpoint, baseUrl: migration.to };
              }
              return endpoint;
            });
            if (endpointChanged) changed = true;
          }
        }
        const endpointMigration = PRESET_ENDPOINT_BASE_URL_MIGRATIONS.get(preset.id);
        if (endpointMigration && Array.isArray(existing.endpoints)) {
          let endpointChanged = false;
          existing.endpoints = existing.endpoints.map(endpoint => {
            if (endpoint && endpoint.baseUrl === endpointMigration.from) {
              endpointChanged = true;
              return { ...endpoint, baseUrl: endpointMigration.to };
            }
            return endpoint;
          });
          if (endpointChanged) changed = true;
        }
        if (existing.name !== preset.name) {
          existing.name = preset.name;
          changed = true;
        }
        if (
          preset.id === "qianfan-coding"
          && existing.models.some(model => ["kimi-k2.5", "deepseek-v3.2", "minimax-m2.5", "ernie-4.5-turbo-20260402"].includes(model.id))
        ) {
          existing.models = preset.models.map(model => ({ ...model }));
          changed = true;
        }
        if (
          preset.id === "xiaomi-coding"
          && existing.models.length === 4
          && existing.models.every(model => ["mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.5-asr", "mimo-v2.5-tts"].includes(model.id))
        ) {
          existing.models = preset.models.map(model => ({ ...model }));
          changed = true;
        }
      }
    }

    // Coding Plan uses a separate API-key scope. Older builds put the Coding
    // endpoint beside the regular Qianfan endpoint, which made one ordinary
    // key look partially broken forever. Keep the regular provider regular;
    // the dedicated qianfan-coding preset owns that endpoint now.
    const qianfan = providers.find(provider => provider.id === "qianfan");
    if (qianfan && Array.isArray(qianfan.endpoints)) {
      const filtered = qianfan.endpoints.filter(endpoint =>
        !/^https?:\/\/qianfan\.baidubce\.com\/v2\/(?:coding|tokenplan\/personal)\/?$/i.test(endpoint.baseUrl),
      );
      if (filtered.length !== qianfan.endpoints.length) {
        if (filtered.length) qianfan.endpoints = filtered;
        else delete qianfan.endpoints;
        if (qianfan.baseUrl === "https://qianfan.baidubce.com/v2/coding") {
          qianfan.baseUrl = "https://qianfan.baidubce.com/v2";
        }
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
  await backupImportantData("providers");
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
