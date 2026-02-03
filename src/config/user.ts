import fs from "fs-extra";
import path from "path";
import os from "os";
import { OKIT_DIR } from "./registry";

type Language = "zh" | "en";

export type UserConfig = {
  language?: Language;
  claude?: {
    name: string;
    model?: string;
  };
  hints?: {
    mainHelpShown?: boolean;
  };
};

const USER_CONFIG_PATH = path.join(OKIT_DIR, "user.json");
const LEGACY_LANG_PATH = path.join(OKIT_DIR, "language.json");
const LEGACY_CLAUDE_PATH = path.join(OKIT_DIR, "claude-current.json");

export async function loadUserConfig(): Promise<UserConfig> {
  const config = await readJson(USER_CONFIG_PATH);
  if (config) return config;

  const migrated = await migrateLegacyConfig();
  if (migrated) {
    await saveUserConfig(migrated);
    return migrated;
  }
  return {};
}

export async function saveUserConfig(config: UserConfig): Promise<void> {
  await fs.ensureDir(OKIT_DIR);
  await fs.writeFile(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function updateUserConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
  const current = await loadUserConfig();
  const merged = {
    ...current,
    ...patch,
    claude: patch.claude ? { ...current.claude, ...patch.claude } : current.claude,
    hints: patch.hints ? { ...current.hints, ...patch.hints } : current.hints,
  };
  await saveUserConfig(merged);
  return merged;
}

async function migrateLegacyConfig(): Promise<UserConfig | null> {
  let changed = false;
  const config: UserConfig = {};

  const legacyLang = await readJson(LEGACY_LANG_PATH);
  if (legacyLang && (legacyLang.lang === "zh" || legacyLang.lang === "en")) {
    config.language = legacyLang.lang;
    changed = true;
  }

  const legacyClaude = await readJson(LEGACY_CLAUDE_PATH);
  if (legacyClaude && typeof legacyClaude.name === "string") {
    config.claude = {
      name: legacyClaude.name,
      model: legacyClaude.model,
    };
    changed = true;
  }

  return changed ? config : null;
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
