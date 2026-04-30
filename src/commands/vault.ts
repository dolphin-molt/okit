import kleur from "kleur";
import fs from "fs-extra";
import path from "path";
import prompts from "prompts";
import { VaultStore, ProjectBinding } from "../vault/store";
import { t } from "../config/i18n";

const store = new VaultStore();

// Parse .okitenv file
// Format — each line: ENV_NAME: VAULT_KEY/alias
//
// Examples:
//   OPENAI_API_KEY: OPENROUTER_KEY       # vault 的 OPENROUTER_KEY → 注入为 OPENAI_API_KEY
//   OPENAI_BASE_URL: OPENROUTER_BASE_URL # vault 的 OPENROUTER_BASE_URL → 注入为 OPENAI_BASE_URL
//   GITHUB_TOKEN: GITHUB_TOKEN/company   # vault 的 GITHUB_TOKEN/company → 注入为 GITHUB_TOKEN
//   DATABASE_URL                          # vault 的 DATABASE_URL/default → 注入为 DATABASE_URL
//
// envName = 项目 .env 里实际写入的变量名
// vaultKey/alias = vault 里存储的 key 和别名
interface OkitEnvEntry {
  envName: string;     // .env 里的变量名（如 OPENAI_API_KEY）
  vaultKey: string;    // vault 里的 key（如 OPENROUTER_KEY）
  vaultAlias: string;  // vault 里的 alias（如 default）
}

async function parseOkitEnv(filePath: string): Promise<OkitEnvEntry[]> {
  if (!(await fs.pathExists(filePath))) return [];
  const content = await fs.readFile(filePath, "utf-8");
  const entries: OkitEnvEntry[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Try "ENV_NAME: VAULT_SOURCE" format
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const envName = line.slice(0, colonIdx).trim();
      const source = line.slice(colonIdx + 1).trim();
      if (source) {
        // Source can be "VAULT_KEY/alias" or just "VAULT_KEY"
        const { key, alias } = VaultStore.parseKeyAlias(source);
        entries.push({ envName, vaultKey: key, vaultAlias: alias });
      } else {
        // No source specified, envName = vaultKey
        entries.push({ envName, vaultKey: envName, vaultAlias: "default" });
      }
      continue;
    }

    // Simple format: just ENV_NAME (same as vault key, default alias)
    if (/^[A-Z_][A-Z0-9_]*$/.test(line)) {
      entries.push({ envName: line, vaultKey: line, vaultAlias: "default" });
    }
  }

  return entries;
}

function findOkitEnv(dir?: string): string | null {
  const cwd = dir || process.cwd();
  const candidates = [".okitenv", ".okit-env"];
  for (const name of candidates) {
    const fp = path.join(cwd, name);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

// okit vault set KEY/alias value
export async function vaultSet(keyAlias: string, value: string): Promise<void> {
  await store.set(keyAlias, value);
  const { key, alias } = VaultStore.parseKeyAlias(keyAlias);
  const display = alias === "default" ? key : `${key}/${alias}`;
  console.log(kleur.green(`${t("vaultSaved")} ${display}`));

  // Auto-sync if there are bindings for this key
  const bindings = await store.getBindings(keyAlias);
  if (bindings.length > 0) {
    console.log(kleur.gray(`${t("vaultAutoSync")} ${bindings.length} ${t("vaultTargets")}`));
    const results = await store.sync();
    const synced = results.filter((r) => r.success).length;
    if (synced > 0) {
      console.log(kleur.green(`  ${t("vaultSynced")} ${synced} ${t("vaultTargets")}`));
    }
  }
}

// okit vault get KEY/alias
export async function vaultGet(keyAlias: string): Promise<void> {
  const parsed = VaultStore.parseKeyAlias(keyAlias);
  const value = await store.resolve(parsed.key, parsed.alias);
  if (value === null) {
    console.log(kleur.red(`${t("vaultNotFound")} ${keyAlias}`));
    process.exit(1);
  }
  // Output raw value (for piping)
  process.stdout.write(value);
}

// okit vault list
export async function vaultList(): Promise<void> {
  const entries = await store.list();
  if (entries.length === 0) {
    console.log(kleur.yellow(t("vaultEmpty")));
    return;
  }

  console.log(kleur.cyan(`\n${t("vaultListTitle")}\n`));

  // Group by key
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const existing = groups.get(e.key) || [];
    existing.push(e);
    groups.set(e.key, existing);
  }

  for (const [key, aliases] of groups) {
    if (aliases.length === 1 && aliases[0].alias === "default") {
      console.log(`  ${kleur.bold(key)}  ${kleur.gray(aliases[0].masked)}`);
    } else {
      console.log(`  ${kleur.bold(key)}`);
      for (const a of aliases) {
        console.log(`    /${kleur.cyan(a.alias)}  ${kleur.gray(a.masked)}`);
      }
    }
  }
  console.log();
}

// okit vault delete KEY/alias
export async function vaultDelete(keyAlias: string): Promise<void> {
  const confirm = await prompts({
    type: "confirm",
    name: "yes",
    message: `${t("vaultConfirmDelete")} ${keyAlias}?`,
    initial: false,
  });
  if (!confirm.yes) return;

  if (await store.delete(keyAlias)) {
    console.log(kleur.green(`${t("vaultDeleted")} ${keyAlias}`));
  } else {
    console.log(kleur.red(`${t("vaultNotFound")} ${keyAlias}`));
  }
}

// okit vault inject — output shell export statements
// Reads .okitenv from current directory to know which keys to inject
export async function vaultInject(options?: { keys?: string; dir?: string; shell?: string }): Promise<void> {
  const dir = options?.dir || process.cwd();
  const targetShell = options?.shell || (process.platform === "win32" ? "powershell" : "bash");
  let entries: OkitEnvEntry[];

  if (options?.keys) {
    entries = options.keys.split(",").map((k) => {
      const { key, alias } = VaultStore.parseKeyAlias(k.trim());
      return { envName: key, vaultKey: key, vaultAlias: alias };
    });
  } else {
    const envFile = findOkitEnv(dir);
    if (!envFile) {
      console.error(kleur.red(t("vaultNoOkitEnv")));
      process.exit(1);
    }
    entries = await parseOkitEnv(envFile);
  }

  if (entries.length === 0) {
    console.error(kleur.red(t("vaultNoKeys")));
    process.exit(1);
  }

  const loadedKeys: string[] = [];
  for (const entry of entries) {
    const value = await store.resolve(entry.vaultKey, entry.vaultAlias);
    if (value !== null) {
      const escaped = value.replace(/'/g, "'\\''");
      if (targetShell === "powershell") {
        process.stdout.write(`$env:${entry.envName} = '${escaped}'\n`);
      } else {
        process.stdout.write(`export ${entry.envName}='${escaped}'\n`);
      }
      loadedKeys.push(entry.envName);
    }
  }

  // Tracking vars for shell hook cleanup
  if (loadedKeys.length > 0 && !options?.keys) {
    if (targetShell === "powershell") {
      process.stdout.write(`$global:_OKIT_LOADED_KEYS = "${loadedKeys.join(" ")}"\n`);
      process.stdout.write(`$global:_OKIT_LOADED_DIR = "${dir}"\n`);
    } else {
      process.stdout.write(`_OKIT_LOADED_KEYS="${loadedKeys.join(" ")}"\n`);
      process.stdout.write(`_OKIT_LOADED_DIR="${dir}"\n`);
      process.stdout.write(`export _OKIT_LOADED_KEYS _OKIT_LOADED_DIR\n`);
    }
  }
}

// okit vault env [file] — write .env file from .okitenv
export async function vaultEnv(targetFile?: string, options?: { dir?: string }): Promise<void> {
  const dir = options?.dir || process.cwd();
  const envFile = findOkitEnv(dir);
  if (!envFile) {
    console.log(kleur.red(t("vaultNoOkitEnv")));
    return;
  }

  const entries = await parseOkitEnv(envFile);
  if (entries.length === 0) {
    console.log(kleur.yellow(t("vaultNoKeys")));
    return;
  }

  const dest = targetFile || ".env";
  const lines: string[] = [];
  let resolved = 0;
  let missing = 0;

  for (const entry of entries) {
    const value = await store.resolve(entry.vaultKey, entry.vaultAlias);
    if (value !== null) {
      lines.push(`${entry.envName}=${value}`);
      resolved++;

      // Register binding for sync (track vault key, write as envName)
      await store.addBinding({
        projectPath: dir,
        file: dest,
        key: entry.vaultKey,
        alias: entry.vaultAlias,
        envName: entry.envName,
      });
    } else {
      const source = entry.vaultAlias === "default" ? entry.vaultKey : `${entry.vaultKey}/${entry.vaultAlias}`;
      lines.push(`# ${entry.envName}= # ${t("vaultNotFound")} ${source}`);
      missing++;
    }
  }

  const fullPath = path.isAbsolute(dest) ? dest : path.join(dir, dest);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, lines.join("\n") + "\n");

  console.log(kleur.green(`${t("vaultEnvWritten")} ${dest}`));
  console.log(kleur.gray(`  ${t("vaultResolved")}: ${resolved}, ${t("vaultMissing")}: ${missing}`));
}

// okit vault where KEY/alias — show where a key is used
export async function vaultWhere(keyAlias: string): Promise<void> {
  const bindings = await store.getBindings(keyAlias);

  if (bindings.length === 0) {
    console.log(kleur.yellow(`${t("vaultNoBindings")} ${keyAlias}`));
    return;
  }

  const { key, alias } = VaultStore.parseKeyAlias(keyAlias);
  const display = alias === "default" ? key : `${key}/${alias}`;
  console.log(kleur.cyan(`\n${t("vaultWhereTitle")} ${display}\n`));

  for (const b of bindings) {
    const fullPath = path.join(b.projectPath, b.file);
    const exists = await fs.pathExists(fullPath);
    const status = exists ? kleur.green("\u2713") : kleur.red("\u2717");
    console.log(`  ${status} ${fullPath}`);
  }
  console.log();
}

// okit vault sync — push current values to all bound files
export async function vaultSync(): Promise<void> {
  console.log(kleur.cyan(t("vaultSyncing")));
  const results = await store.sync();

  if (results.length === 0) {
    console.log(kleur.yellow(t("vaultNoBindings")));
    return;
  }

  let success = 0;
  let failed = 0;

  for (const r of results) {
    if (r.success) {
      console.log(`  ${kleur.green("\u2713")} ${r.file} → ${r.key}`);
      success++;
    } else {
      console.log(`  ${kleur.red("\u2717")} ${r.file} → ${r.key}: ${r.error}`);
      failed++;
    }
  }

  console.log(kleur.cyan(`\n${t("vaultSyncResult")}`));
  console.log(kleur.green(`  ${t("success")}: ${success}`));
  if (failed > 0) console.log(kleur.red(`  ${t("failed")}: ${failed}`));
}
