import prompts from "prompts";
import kleur from "kleur";
import fs from "fs-extra";
import path from "path";
import { OKIT_DIR, loadRegistry, resolveCmd } from "../config/registry";
import { executeSteps } from "../executor/runner";
import { t } from "../config/i18n";

const PROFILES_DIR = path.join(OKIT_DIR, "profiles");

export interface Profile {
  name: string;
  description?: string;
  tools: string[];
}

async function ensureProfilesDir(): Promise<void> {
  await fs.ensureDir(PROFILES_DIR);
}

function profilePath(name: string): string {
  return path.join(PROFILES_DIR, `${name}.json`);
}

export async function listProfiles(): Promise<Profile[]> {
  await ensureProfilesDir();
  const files = await fs.readdir(PROFILES_DIR);
  const profiles: Profile[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = await fs.readFile(path.join(PROFILES_DIR, file), "utf-8");
      profiles.push(JSON.parse(content));
    } catch {
      // skip invalid files
    }
  }
  return profiles;
}

export async function getProfile(name: string): Promise<Profile | null> {
  const fp = profilePath(name);
  if (!(await fs.pathExists(fp))) return null;
  try {
    const content = await fs.readFile(fp, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function saveProfile(profile: Profile): Promise<void> {
  await ensureProfilesDir();
  await fs.writeFile(profilePath(profile.name), JSON.stringify(profile, null, 2));
}

export async function deleteProfile(name: string): Promise<boolean> {
  const fp = profilePath(name);
  if (!(await fs.pathExists(fp))) return false;
  await fs.remove(fp);
  return true;
}

// okit profile create - interactive
export async function createProfile(): Promise<void> {
  const registry = await loadRegistry();
  const availableTools = registry.steps
    .filter((s) => resolveCmd(s.install) !== undefined)
    .map((s) => s.name);

  const nameRes = await prompts({
    type: "text",
    name: "name",
    message: t("profileName"),
    validate: (v: string) => (v.trim().length > 0 ? true : t("profileNameRequired")),
  });
  if (!nameRes.name) return;

  const existing = await getProfile(nameRes.name);
  if (existing) {
    const overwrite = await prompts({
      type: "confirm",
      name: "yes",
      message: t("profileExists"),
      initial: false,
    });
    if (!overwrite.yes) return;
  }

  const descRes = await prompts({
    type: "text",
    name: "desc",
    message: t("profileDesc"),
  });

  const toolRes = await prompts({
    type: "autocompleteMultiselect",
    name: "tools",
    message: t("profileSelectTools"),
    choices: availableTools.map((name) => ({ title: name, value: name })),
    suggest: (input: string, choices: any[]) =>
      Promise.resolve(
        choices.filter((c) => c.title.toLowerCase().includes(input.toLowerCase()))
      ),
  });
  if (!toolRes.tools || toolRes.tools.length === 0) {
    console.log(kleur.yellow(t("profileNoTools")));
    return;
  }

  const profile: Profile = {
    name: nameRes.name.trim(),
    description: descRes.desc?.trim() || undefined,
    tools: toolRes.tools,
  };

  await saveProfile(profile);
  console.log(kleur.green(`\n${t("profileCreated")} ${profile.name} (${profile.tools.length} ${t("profileToolCount")})`));
}

// okit profile apply <name> - install all tools in profile
export async function applyProfile(name?: string): Promise<void> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    console.log(kleur.yellow(t("profileEmpty")));
    return;
  }

  let targetName = name;
  if (!targetName) {
    const res = await prompts({
      type: "select",
      name: "profile",
      message: t("profileSelectApply"),
      choices: profiles.map((p) => ({
        title: `${p.name}${p.description ? kleur.gray(` - ${p.description}`) : ""} (${p.tools.length})`,
        value: p.name,
      })),
    });
    if (!res.profile) return;
    targetName = res.profile;
  }

  const profile = await getProfile(targetName!);
  if (!profile) {
    console.log(kleur.red(`${t("profileNotFound")} ${targetName}`));
    return;
  }

  const registry = await loadRegistry();
  const steps = registry.steps.filter((s) => profile.tools.includes(s.name));
  const missing = profile.tools.filter((name) => !registry.steps.find((s) => s.name === name));

  console.log(kleur.cyan(`\n${t("profileApplying")} ${profile.name}`));
  if (profile.description) {
    console.log(kleur.gray(`  ${profile.description}`));
  }
  console.log(kleur.gray(`  ${t("profileToolCount")}: ${steps.length}`));
  if (missing.length > 0) {
    console.log(kleur.yellow(`  ${t("profileMissingTools")}: ${missing.join(", ")}`));
  }
  console.log();

  // Show tools list
  for (const step of steps) {
    console.log(kleur.gray(`  - ${step.name}`));
  }

  const confirm = await prompts({
    type: "confirm",
    name: "yes",
    message: t("profileConfirmApply"),
    initial: true,
  });
  if (!confirm.yes) return;

  console.log();
  const results = await executeSteps(steps, "install", registry);

  const succeeded = results.filter((r) => r.success && r.action !== "skip").length;
  const failed = results.filter((r) => !r.success && r.action !== "skip").length;
  const skipped = results.filter((r) => r.action === "skip").length;

  console.log(kleur.cyan(`\n${t("profileApplyResult")}`));
  console.log(kleur.green(`  ${t("success")}: ${succeeded}`));
  if (failed > 0) console.log(kleur.red(`  ${t("failed")}: ${failed}`));
  if (skipped > 0) console.log(kleur.gray(`  ${t("skipped")}: ${skipped}`));
}

// okit profile list
export async function showProfiles(): Promise<void> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    console.log(kleur.yellow(t("profileEmpty")));
    return;
  }

  console.log(kleur.cyan(`\n${t("profileListTitle")}\n`));
  for (const p of profiles) {
    console.log(`  ${kleur.bold(p.name)}${p.description ? kleur.gray(` - ${p.description}`) : ""}`);
    console.log(kleur.gray(`    ${p.tools.join(", ")}`));
    console.log();
  }
}

// okit profile show <name>
export async function showProfileDetail(name: string): Promise<void> {
  const profile = await getProfile(name);
  if (!profile) {
    console.log(kleur.red(`${t("profileNotFound")} ${name}`));
    return;
  }

  const registry = await loadRegistry();

  console.log(kleur.cyan(`\n  ${kleur.bold(profile.name)}`));
  if (profile.description) {
    console.log(kleur.gray(`  ${profile.description}`));
  }
  console.log();

  for (const toolName of profile.tools) {
    const step = registry.steps.find((s) => s.name === toolName);
    if (!step) {
      console.log(`  ${kleur.red("?")} ${toolName} ${kleur.gray("(not in registry)")}`);
      continue;
    }
    // Quick check if installed
    const checkCmd = resolveCmd(step.check);
    if (checkCmd) {
      try {
        const { execSync } = await import("child_process");
        execSync(checkCmd, { stdio: "ignore" });
        console.log(`  ${kleur.green("\u2713")} ${toolName}`);
      } catch {
        console.log(`  ${kleur.red("\u2717")} ${toolName} ${kleur.gray("(" + t("checkNotInstalled") + ")")}`);
      }
    } else {
      console.log(`  ${kleur.gray("-")} ${toolName}`);
    }
  }
  console.log();
}

// okit profile delete
export async function removeProfile(name?: string): Promise<void> {
  if (!name) {
    const profiles = await listProfiles();
    if (profiles.length === 0) {
      console.log(kleur.yellow(t("profileEmpty")));
      return;
    }
    const res = await prompts({
      type: "select",
      name: "profile",
      message: t("profileSelectDelete"),
      choices: profiles.map((p) => ({ title: p.name, value: p.name })),
    });
    if (!res.profile) return;
    name = res.profile;
  }

  const confirm = await prompts({
    type: "confirm",
    name: "yes",
    message: `${t("profileConfirmDelete")} ${name}?`,
    initial: false,
  });
  if (!confirm.yes) return;

  if (await deleteProfile(name!)) {
    console.log(kleur.green(`${t("profileDeleted")} ${name}`));
  } else {
    console.log(kleur.red(`${t("profileNotFound")} ${name}`));
  }
}

// okit profile export <name>
export async function exportProfile(name?: string, outputPath?: string): Promise<void> {
  if (!name) {
    const profiles = await listProfiles();
    if (profiles.length === 0) {
      console.log(kleur.yellow(t("profileEmpty")));
      return;
    }
    const res = await prompts({
      type: "select",
      name: "profile",
      message: t("profileSelectExport"),
      choices: profiles.map((p) => ({ title: p.name, value: p.name })),
    });
    if (!res.profile) return;
    name = res.profile;
  }

  const profile = await getProfile(name!);
  if (!profile) {
    console.log(kleur.red(`${t("profileNotFound")} ${name}`));
    return;
  }

  const dest = outputPath || `okit-profile-${profile.name}.json`;
  await fs.writeFile(dest, JSON.stringify(profile, null, 2));
  console.log(kleur.green(`${t("profileExported")} ${dest}`));
}

// okit profile import <file>
export async function importProfile(filePath: string): Promise<void> {
  if (!(await fs.pathExists(filePath))) {
    console.log(kleur.red(`${t("profileFileNotFound")} ${filePath}`));
    return;
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const profile = JSON.parse(content) as Profile;

    if (!profile.name || !Array.isArray(profile.tools)) {
      console.log(kleur.red(t("profileInvalidFormat")));
      return;
    }

    const existing = await getProfile(profile.name);
    if (existing) {
      const overwrite = await prompts({
        type: "confirm",
        name: "yes",
        message: `${t("profileExists")} (${profile.name})`,
        initial: false,
      });
      if (!overwrite.yes) return;
    }

    await saveProfile(profile);
    console.log(kleur.green(`${t("profileImported")} ${profile.name} (${profile.tools.length} ${t("profileToolCount")})`));
  } catch {
    console.log(kleur.red(t("profileInvalidFormat")));
  }
}

// Interactive profile menu
export async function showProfileMenu(): Promise<void> {
  while (true) {
    const profiles = await listProfiles();
    const res = await prompts({
      type: "select",
      name: "action",
      message: t("profileMenu"),
      choices: [
        { title: t("profileActionCreate"), value: "create" },
        { title: `${t("profileActionApply")}${profiles.length > 0 ? ` (${profiles.length})` : ""}`, value: "apply" },
        { title: t("profileActionList"), value: "list" },
        { title: t("profileActionDelete"), value: "delete" },
        { title: t("profileActionExport"), value: "export" },
        { title: t("profileActionImport"), value: "import" },
        { title: t("back"), value: "back" },
      ],
    });

    switch (res.action) {
      case "create":
        await createProfile();
        break;
      case "apply":
        await applyProfile();
        break;
      case "list":
        await showProfiles();
        break;
      case "delete":
        await removeProfile();
        break;
      case "export":
        await exportProfile();
        break;
      case "import": {
        const fileRes = await prompts({
          type: "text",
          name: "path",
          message: t("profileImportPath"),
        });
        if (fileRes.path) await importProfile(fileRes.path);
        break;
      }
      case "back":
      default:
        return;
    }
  }
}
