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

export type ClaudeTeammateMode = "auto" | "in-process" | "tmux";

type ClaudeRunOptions = {
  teammateModeOverride?: ClaudeTeammateMode;
};

const PROFILES_PATH = path.join(OKIT_DIR, "claude-profiles.json");
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const ZSHRC_PATH = path.join(os.homedir(), ".zshrc");
const BLOCK_START = "# >>> OKIT_CLAUDE";
const BLOCK_END = "# <<< OKIT_CLAUDE";
const CLAUDE_EXPERIMENTAL_AGENT_TEAMS = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";

const PRESET_PROFILES: Omit<ClaudeProfile, "authToken">[] = [
  {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude 4.6 opus"],
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
    models: ["glm-4.7"],
  },
  {
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/anthropic",
    models: ["MiniMax-M2.1"],
  },
];

export async function runClaudeCommand(
  mode: "run" | "switch",
  options?: ClaudeRunOptions
): Promise<void> {
  const profiles = await loadProfiles();
  if (!profiles || profiles.length === 0) {
    console.log(kleur.yellow(t("claudeMissingProfiles")));
    return;
  }

  let current = await loadCurrent();
  const agentTeamsEnabled = await loadAgentTeamsEnabled();
  const configuredTeammateMode = await loadTeammateMode();
  const teammateMode = options?.teammateModeOverride ?? configuredTeammateMode;
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
    await applyProfile(selectedProfile, selectedModel, agentTeamsEnabled, teammateMode);
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
    await applyProfile(selectedProfile, selectedModel, agentTeamsEnabled, teammateMode);
  }

  await launchClaude(teammateMode);
}

export async function configureClaudeAgentTeams(enabled?: boolean): Promise<void> {
  let selected = enabled;
  if (typeof selected !== "boolean") {
    const current = await loadAgentTeamsEnabled();
    const response = await prompts({
      type: "select",
      name: "enabled",
      message: t("claudeTeamsPrompt"),
      choices: [
        { title: `${t("claudeTeamsEnabled")}${current ? " ✅" : ""}`, value: true },
        { title: `${t("claudeTeamsDisabled")}${!current ? " ✅" : ""}`, value: false },
      ],
    });
    if (typeof response.enabled !== "boolean") {
      console.log(kleur.gray(t("claudeCancel")));
      return;
    }
    selected = response.enabled;
  }

  await updateUserConfig({ claude: { agentTeams: selected } });
  await syncClaudeSettingsForCurrentProfile();
  const statusText = selected ? t("claudeTeamsEnabled") : t("claudeTeamsDisabled");
  console.log(kleur.green(`${t("claudeTeamsStatus")}: ${statusText}`));
}

export async function configureClaudeTeammateMode(mode?: ClaudeTeammateMode): Promise<void> {
  let selected = mode;
  if (!selected) {
    const current = await loadTeammateMode();
    const response = await prompts({
      type: "select",
      name: "mode",
      message: t("claudeModePrompt"),
      choices: [
        { title: `${t("claudeModeAuto")}${current === "auto" ? " ✅" : ""}`, value: "auto" },
        { title: `${t("claudeModeInProcess")}${current === "in-process" ? " ✅" : ""}`, value: "in-process" },
        { title: `${t("claudeModeTmux")}${current === "tmux" ? " ✅" : ""}`, value: "tmux" },
      ],
    });
    if (!response.mode) {
      console.log(kleur.gray(t("claudeCancel")));
      return;
    }
    selected = response.mode;
  }

  await updateUserConfig({ claude: { teammateMode: selected } });
  await syncClaudeSettingsForCurrentProfile();
  console.log(kleur.green(`${t("claudeModeStatus")}: ${selected}`));
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
  const defaultAnthropicProfile = getDefaultAnthropicProfile();
  if (!(await fs.pathExists(PROFILES_PATH))) {
    return [defaultAnthropicProfile];
  }
  try {
    const content = await fs.readFile(PROFILES_PATH, "utf-8");
    const data = JSON.parse(content);
    if (!Array.isArray(data)) return [defaultAnthropicProfile];
    const profiles = data.filter(isValidProfile);
    if (!profiles.some((p) => isOfficialAnthropicPreset(p.name, p.baseUrl))) {
      profiles.unshift(defaultAnthropicProfile);
    }
    return profiles;
  } catch {
    return [defaultAnthropicProfile];
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
    if (isOfficialAnthropicPreset(preset.name, preset.baseUrl)) {
      console.log(kleur.yellow(t("claudeLoginRequired")));
      return {
        name: preset.name,
        baseUrl: preset.baseUrl,
        authToken: "",
        models: preset.models,
      };
    }
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

async function applyProfile(
  profile: ClaudeProfile,
  model: string,
  agentTeamsEnabled: boolean,
  teammateMode: ClaudeTeammateMode
): Promise<void> {
  await cleanupLegacyZshrcBlock();
  await updateClaudeSettings(
    profile,
    model,
    agentTeamsEnabled,
    teammateMode
  );
}

async function launchClaude(teammateMode: ClaudeTeammateMode): Promise<void> {
  try {
    const args: string[] = [];
    if (teammateMode !== "auto") {
      args.push("--teammate-mode", teammateMode);
    }
    await execa("claude", args, { stdio: "inherit" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(kleur.red(`✗ 启动 Claude 失败: ${message}`));
  }
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

async function updateClaudeSettings(
  profile: ClaudeProfile,
  model: string,
  agentTeamsEnabled: boolean,
  teammateMode: ClaudeTeammateMode
) : Promise<void> {
  await fs.ensureDir(path.dirname(CLAUDE_SETTINGS_PATH));

  let data: Record<string, any> = {};
  if (await fs.pathExists(CLAUDE_SETTINGS_PATH)) {
    const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
    data = content.trim() ? JSON.parse(content) : {};
  }

  const env =
    typeof data.env === "object" && data.env
      ? (data.env as Record<string, any>)
      : {};
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_MODEL;
  if (agentTeamsEnabled) {
    env[CLAUDE_EXPERIMENTAL_AGENT_TEAMS] = "1";
  } else {
    delete env[CLAUDE_EXPERIMENTAL_AGENT_TEAMS];
  }
  if (Object.keys(env).length === 0) {
    delete data.env;
  } else {
    data.env = env;
  }

  data.teammateMode = teammateMode;

  await fs.writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(data, null, 2));
}

async function syncClaudeSettingsForCurrentProfile(): Promise<void> {
  const current = await loadCurrent();
  if (!current?.name) return;

  const profiles = await loadProfiles();
  if (!profiles || profiles.length === 0) return;
  const profile = profiles.find((p) => p.name === current.name);
  if (!profile) return;

  const model = current.model && profile.models.includes(current.model)
    ? current.model
    : profile.models[0];
  if (!model) return;

  const agentTeamsEnabled = await loadAgentTeamsEnabled();
  const teammateMode = await loadTeammateMode();
  await updateClaudeSettings(profile, model, agentTeamsEnabled, teammateMode);
}

async function cleanupLegacyZshrcBlock(): Promise<void> {
  if (!(await fs.pathExists(ZSHRC_PATH))) return;
  const content = await fs.readFile(ZSHRC_PATH, "utf-8");
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start < 0 || end < 0 || end <= start) return;

  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + BLOCK_END.length).trimStart();
  const updated = [before, after].filter(Boolean).join("\n");
  await fs.writeFile(ZSHRC_PATH, updated);
}

async function loadAgentTeamsEnabled(): Promise<boolean> {
  const config = await loadUserConfig();
  return config.claude?.agentTeams !== false;
}

async function loadTeammateMode(): Promise<ClaudeTeammateMode> {
  const config = await loadUserConfig();
  const mode = config.claude?.teammateMode;
  if (mode === "in-process" || mode === "tmux" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function isOfficialAnthropicPreset(name: string, baseUrl: string): boolean {
  return name.toLowerCase() === "anthropic" && baseUrl === "https://api.anthropic.com";
}

function getDefaultAnthropicProfile(): ClaudeProfile {
  const preset = PRESET_PROFILES.find((p) => isOfficialAnthropicPreset(p.name, p.baseUrl));
  if (!preset) {
    return {
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      authToken: "",
      models: ["claude 4.6 opus"],
    };
  }
  return {
    name: preset.name,
    baseUrl: preset.baseUrl,
    authToken: "",
    models: preset.models,
  };
}
