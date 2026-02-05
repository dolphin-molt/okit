import fs from "fs-extra";
import path from "path";
import os from "os";
import execa from "execa";
import prompts from "prompts";
import kleur from "kleur";
import { OKIT_DIR } from "../config/registry";
import { loadUserConfig, updateUserConfig } from "../config/user";
import { t } from "../config/i18n";

type ClaudeProfile = {
  name: string;
  baseUrl: string;
  authToken: string;
  models: string[];
};

type ClaudeCurrent = {
  name: string;
  model?: string;
};

const PROFILES_PATH = path.join(OKIT_DIR, "claude-profiles.json");
const ZSHRC_PATH = path.join(os.homedir(), ".zshrc");
const BLOCK_START = "# >>> OKIT_CLAUDE";
const BLOCK_END = "# <<< OKIT_CLAUDE";

const PRESET_PROFILES: Omit<ClaudeProfile, "authToken">[] = [
  {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
  },
  {
    name: "Volcengine",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    models: [
      "doubao-seed-code",
      "glm4.7",
      "deepseek-v3.2",
      "kimi-k2-thinking",
      "kimi-k2.5",
    ],
  },
  {
    name: "BigModel",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    models: ["glm4.7"],
  },
  {
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/anthropic",
    models: ["MiniMax-M2.1"],
  },
];

export async function runClaudeCommand(mode: "run" | "switch"): Promise<void> {
  const profiles = await loadProfiles();
  if (!profiles || profiles.length === 0) {
    console.log(kleur.yellow(t("claudeMissingProfiles")));
    return;
  }

  let current = await loadCurrent();
  let selectedProfile: ClaudeProfile | undefined;
  let selectedModel: string | undefined;

  if (!current || mode === "switch") {
    selectedProfile = await promptSelectProfile(profiles, current?.name, current?.model);
    if (!selectedProfile) {
      console.log(kleur.gray(t("claudeCancel")));
      return;
    }
    selectedModel = await promptSelectModel(
      selectedProfile.models,
      current?.model
    );
    if (!selectedModel) {
      console.log(kleur.gray(t("claudeCancel")));
      return;
    }
    await applyProfile(selectedProfile, selectedModel);
    await saveCurrent({ name: selectedProfile.name, model: selectedModel });
    current = { name: selectedProfile.name, model: selectedModel };
    console.log(
      kleur.green(`${selectedProfile.name} / ${selectedModel}`)
    );
  } else {
    selectedProfile = profiles.find((p) => p.name === current?.name);
    if (!selectedProfile) {
      selectedProfile = await promptSelectProfile(profiles, current?.name, current?.model);
      if (!selectedProfile) {
        console.log(kleur.gray(t("claudeCancel")));
        return;
      }
    }
    if (current?.model && selectedProfile.models.includes(current.model)) {
      selectedModel = current.model;
    } else {
      selectedModel = await promptSelectModel(
        selectedProfile.models,
        selectedProfile.models[0]
      );
      if (!selectedModel) {
        console.log(kleur.gray(t("claudeCancel")));
        return;
      }
      await saveCurrent({ name: selectedProfile.name, model: selectedModel });
    }
    await applyProfile(selectedProfile, selectedModel);
  }

  await launchClaude();
}

export async function addClaudeProfile(): Promise<void> {
  const profile = await promptAddProfile();
  if (!profile) {
    console.log(kleur.gray(t("claudeCancel")));
    return;
  }

  const profiles = (await loadProfiles()) || [];
  const existsIndex = profiles.findIndex((p) => p.name === profile.name);
  if (existsIndex >= 0) {
    console.log(kleur.yellow(t("claudeExists")));
    const overwrite = await prompts({
      type: "confirm",
      name: "confirm",
      message: t("claudeOverwriteConfirm"),
      initial: true,
    });
    if (!overwrite.confirm) {
      console.log(kleur.gray(t("claudeCancel")));
      return;
    }
    profiles[existsIndex] = profile;
  } else {
    profiles.push(profile);
  }
  await fs.ensureDir(OKIT_DIR);
  await fs.writeFile(PROFILES_PATH, JSON.stringify(profiles, null, 2));
  console.log(kleur.green(`${t("claudeAdded")}: ${profile.name}`));
}

async function loadProfiles(): Promise<ClaudeProfile[] | null> {
  if (!(await fs.pathExists(PROFILES_PATH))) {
    return null;
  }
  try {
    const content = await fs.readFile(PROFILES_PATH, "utf-8");
    const data = JSON.parse(content);
    if (!Array.isArray(data)) return null;
    return data.filter(isValidProfile);
  } catch {
    return null;
  }
}

async function loadCurrent(): Promise<ClaudeCurrent | null> {
  const config = await loadUserConfig();
  if (config.claude && typeof config.claude.name === "string") {
    return { name: config.claude.name, model: config.claude.model };
  }
  return null;
}

async function saveCurrent(current: ClaudeCurrent): Promise<void> {
  await updateUserConfig({ claude: current });
}

async function promptSelectProfile(
  profiles: ClaudeProfile[],
  currentName?: string,
  currentModel?: string
): Promise<ClaudeProfile | undefined> {
  const choices = profiles.map((p) => ({
    title: `${p.name}${p.name === currentName ? " ✅" : ""}  |  ${modelPreview(p.models, p.name === currentName ? currentModel : undefined)}  |  ${shorten(p.baseUrl)}`,
    value: p.name,
  }));

  const response = await prompts({
    type: "select",
    name: "name",
    message: t("claudeSelectProvider"),
    choices,
  });

  if (!response.name) return undefined;
  return profiles.find((p) => p.name === response.name);
}

async function promptSelectModel(
  models: string[],
  currentModel?: string
): Promise<string | undefined> {
  if (!models || models.length === 0) return undefined;
  if (models.length === 1) return models[0];

  const choices = models.map((model) => ({
    title: `${model}${model === currentModel ? " ✅" : ""}`,
    value: model,
  }));

  const response = await prompts({
    type: "select",
    name: "model",
    message: t("claudeSelectModel"),
    choices,
  });

  if (!response.model) return undefined;
  return String(response.model);
}

async function promptAddProfile(): Promise<ClaudeProfile | undefined> {
  const presetChoices = PRESET_PROFILES.map((preset) => ({
    title: `${preset.name}  |  ${modelPreview(preset.models)}  |  ${shorten(preset.baseUrl)}`,
    value: preset.name,
  }));
  presetChoices.push({ title: t("claudePresetCustom"), value: "custom" });

  const presetResponse = await prompts({
    type: "select",
    name: "preset",
    message: t("claudePreset"),
    choices: presetChoices,
  });

  if (!presetResponse.preset) return undefined;

  if (presetResponse.preset !== "custom") {
    const preset = PRESET_PROFILES.find((p) => p.name === presetResponse.preset);
    if (!preset) return undefined;
    const keyResponse = await prompts({
      type: "password",
      name: "authToken",
      message: t("claudeApiKeyOnly"),
    });
    if (!keyResponse.authToken) return undefined;
    return {
      name: preset.name,
      baseUrl: preset.baseUrl,
      authToken: String(keyResponse.authToken).trim(),
      models: preset.models,
    };
  }

  const response = await prompts([
    {
      type: "text",
      name: "name",
      message: t("claudeName"),
    },
    {
      type: "text",
      name: "baseUrl",
      message: t("claudeBaseUrl"),
    },
    {
      type: "password",
      name: "authToken",
      message: t("claudeAuthToken"),
    },
    {
      type: "text",
      name: "models",
      message: t("claudeModels"),
    },
  ]);

  if (!response.name || !response.baseUrl || !response.authToken || !response.models) {
    return undefined;
  }

  const models = String(response.models)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (models.length === 0) return undefined;

  return {
    name: String(response.name).trim(),
    baseUrl: String(response.baseUrl).trim(),
    authToken: String(response.authToken).trim(),
    models,
  };
}

async function applyProfile(profile: ClaudeProfile, model: string): Promise<void> {
  process.env.ANTHROPIC_BASE_URL = profile.baseUrl;
  process.env.ANTHROPIC_AUTH_TOKEN = profile.authToken;
  process.env.ANTHROPIC_MODEL = model;

  const block = [
    BLOCK_START,
    `export ANTHROPIC_BASE_URL="${profile.baseUrl}"`,
    `export ANTHROPIC_AUTH_TOKEN="${profile.authToken}"`,
    `export ANTHROPIC_MODEL="${model}"`,
    BLOCK_END,
    "",
  ].join("\n");

  const existing = (await fs.pathExists(ZSHRC_PATH))
    ? await fs.readFile(ZSHRC_PATH, "utf-8")
    : "";

  const updated = replaceOrAppendBlock(existing, block);
  await fs.writeFile(ZSHRC_PATH, updated);
}

async function launchClaude(): Promise<void> {
  try {
    await execa.command("claude", { shell: true, stdio: "inherit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`✗ 启动 Claude 失败: ${message}`));
  }
}

function replaceOrAppendBlock(content: string, block: string): string {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start >= 0 && end >= 0 && end > start) {
    const before = content.slice(0, start).trimEnd();
    const after = content.slice(end + BLOCK_END.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n");
  }
  const trimmed = content.trimEnd();
  if (!trimmed) return block;
  return `${trimmed}\n\n${block}`;
}

function shorten(value: string): string {
  if (value.length <= 36) return value;
  return `${value.slice(0, 16)}...${value.slice(-12)}`;
}

function isValidProfile(value: any): value is ClaudeProfile {
  return (
    value &&
    typeof value.name === "string" &&
    typeof value.baseUrl === "string" &&
    typeof value.authToken === "string" &&
    Array.isArray(value.models) &&
    value.models.every((model: any) => typeof model === "string")
  );
}

function modelPreview(models: string[], currentModel?: string): string {
  if (!models || models.length === 0) return "-";
  if (models.length === 1) return models[0];
  if (currentModel && models.includes(currentModel)) {
    return `${currentModel} (+${models.length - 1})`;
  }
  return `${models[0]} (+${models.length - 1})`;
}
