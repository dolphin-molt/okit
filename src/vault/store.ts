import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import os from "os";
import { OKIT_DIR } from "../config/registry";
import { backupImportantData } from "../config/backup";

const VAULT_DIR = path.join(OKIT_DIR, "vault");
const SECRETS_FILE = path.join(VAULT_DIR, "secrets.enc");
const MASTER_KEY_FILE = path.join(VAULT_DIR, "master.key");
const REGISTRY_FILE = path.join(VAULT_DIR, "registry.json");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Secret entry: KEY_NAME/alias → encrypted value
export interface SecretEntry {
  key: string;       // e.g. "GITHUB_TOKEN"
  alias: string;     // e.g. "personal", "company", "default"
  value: string;     // plaintext (only in memory after decrypt)
  group?: string;    // freeform group name, e.g. "OpenAI", "Stripe", empty = ungrouped
  expiresAt?: string; // ISO date when the secret expires, empty = no expiry
  createdAt: string;
  updatedAt: string;
}

// Project registration: which project uses which key/alias
export interface ProjectBinding {
  projectPath: string;   // absolute path to project root
  file: string;          // relative path to target file (e.g. ".env")
  key: string;           // vault key (e.g. "OPENROUTER_KEY")
  alias: string;         // vault alias (e.g. "default")
  envName?: string;      // .env variable name if different from key (e.g. "OPENAI_API_KEY")
}

export interface VaultData {
  secrets: SecretEntry[];
  bindings: ProjectBinding[];
}

// Derive encryption key from machine fingerprint
function deriveMasterKey(): Buffer {
  const fp = path.join(VAULT_DIR, "master.key");
  if (fs.existsSync(fp)) {
    return Buffer.from(fs.readFileSync(fp, "utf-8"), "hex");
  }

  // Generate from machine identity
  const identity = `${os.hostname()}:${os.userInfo().username}:okit-vault`;
  const key = crypto.pbkdf2Sync(identity, "okit-vault-salt", 100000, KEY_LENGTH, "sha256");

  fs.ensureDirSync(VAULT_DIR);
  fs.writeFileSync(fp, key.toString("hex"), { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(data: string, key: Buffer): string {
  const parts = data.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted data format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

function maskValue(value: string): string {
  if (value.length <= 6) return "***";
  return value.slice(0, 3) + "***" + value.slice(-3);
}

export class VaultStore {
  private key: Buffer;
  private data: VaultData | null = null;

  constructor() {
    fs.ensureDirSync(VAULT_DIR);
    this.key = deriveMasterKey();
  }

  private async load(): Promise<VaultData> {
    if (this.data) return this.data;

    let secrets: SecretEntry[] = [];
    let bindings: ProjectBinding[] = [];

    if (await fs.pathExists(SECRETS_FILE)) {
      const raw = await fs.readFile(SECRETS_FILE, "utf-8");
      const decrypted = decrypt(raw, this.key);
      secrets = JSON.parse(decrypted);
      for (const s of secrets) { if (s.group === undefined) s.group = ''; if (s.expiresAt === undefined) s.expiresAt = ''; }
    }

    if (await fs.pathExists(REGISTRY_FILE)) {
      const reg = await fs.readFile(REGISTRY_FILE, "utf-8");
      bindings = JSON.parse(reg);
    }

    this.data = { secrets, bindings };

    return this.data!;
  }

  async reload(): Promise<void> {
    this.data = null;
    await this.load();
  }

  private async save(): Promise<void> {
    if (!this.data) return;

    await backupImportantData("vault");

    // Encrypt secrets
    const secretsJson = JSON.stringify(this.data.secrets);
    const encrypted = encrypt(secretsJson, this.key);
    await fs.writeFile(SECRETS_FILE, encrypted, { mode: 0o600 });

    // Save bindings separately (unencrypted, just paths)
    await fs.writeFile(REGISTRY_FILE, JSON.stringify(this.data.bindings, null, 2));
  }

  // Parse "KEY/alias" format, default alias is "default"
  static parseKeyAlias(input: string): { key: string; alias: string } {
    const slashIdx = input.indexOf("/");
    if (slashIdx === -1) {
      return { key: input, alias: "default" };
    }
    return { key: input.slice(0, slashIdx), alias: input.slice(slashIdx + 1) };
  }

  async set(keyAlias: string, value: string, group?: string, expiresAt?: string): Promise<void> {
    const { key, alias } = VaultStore.parseKeyAlias(keyAlias);
    const data = await this.load();
    const now = new Date().toISOString();

    const existing = data.secrets.find((s) => s.key === key && s.alias === alias);
    if (existing) {
      existing.value = value;
      if (group !== undefined) existing.group = group;
      if (expiresAt !== undefined) existing.expiresAt = expiresAt;
      existing.updatedAt = now;
    } else {
      data.secrets.push({ key, alias, value, group: group || '', expiresAt: expiresAt || '', createdAt: now, updatedAt: now });
    }

    await this.save();
  }

  async get(keyAlias: string): Promise<string | null> {
    const { key, alias } = VaultStore.parseKeyAlias(keyAlias);
    const data = await this.load();
    const entry = data.secrets.find((s) => s.key === key && s.alias === alias);
    return entry?.value ?? null;
  }

  async delete(keyAlias: string): Promise<boolean> {
    const { key, alias } = VaultStore.parseKeyAlias(keyAlias);
    const data = await this.load();
    const idx = data.secrets.findIndex((s) => s.key === key && s.alias === alias);
    if (idx === -1) return false;
    data.secrets.splice(idx, 1);
    // Remove related bindings
    data.bindings = data.bindings.filter(
      (b) => !(b.key === key && b.alias === alias)
    );
    await this.save();
    return true;
  }

  async list(): Promise<Array<{ key: string; alias: string; masked: string; group: string; expiresAt: string; updatedAt: string }>> {
    const data = await this.load();
    return data.secrets.map((s) => ({
      key: s.key,
      alias: s.alias,
      masked: maskValue(s.value),
      group: s.group || '',
      expiresAt: s.expiresAt || '',
      updatedAt: s.updatedAt,
    }));
  }

  async exportAll(): Promise<Array<{ key: string; alias: string; value: string; group: string; expiresAt: string; updatedAt: string }>> {
    const data = await this.load();
    return data.secrets.map((s) => ({
      key: s.key,
      alias: s.alias,
      value: s.value,
      group: s.group || '',
      expiresAt: s.expiresAt || '',
      updatedAt: s.updatedAt,
    }));
  }

  // Get all aliases for a key
  async getAliases(key: string): Promise<string[]> {
    const data = await this.load();
    return data.secrets.filter((s) => s.key === key).map((s) => s.alias);
  }

  // Resolve a key for a project: look up .okitenv mapping, fall back to "default"
  async resolve(key: string, alias?: string): Promise<string | null> {
    const data = await this.load();
    const targetAlias = alias || "default";
    const entry = data.secrets.find((s) => s.key === key && s.alias === targetAlias);
    if (entry) return entry.value;
    // Fall back to default if specific alias not found
    if (targetAlias !== "default") {
      const def = data.secrets.find((s) => s.key === key && s.alias === "default");
      return def?.value ?? null;
    }
    // Fall back to first available alias
    const any = data.secrets.find((s) => s.key === key);
    return any?.value ?? null;
  }

  // Project binding management
  async addBinding(binding: ProjectBinding): Promise<void> {
    const data = await this.load();
    // Deduplicate by project + file + envName
    const targetEnvName = binding.envName || binding.key;
    const exists = data.bindings.find(
      (b) =>
        b.projectPath === binding.projectPath &&
        b.file === binding.file &&
        (b.envName || b.key) === targetEnvName
    );
    if (exists) {
      exists.key = binding.key;
      exists.alias = binding.alias;
      exists.envName = binding.envName;
    } else {
      data.bindings.push(binding);
    }
    await this.save();
  }

  async getBindings(keyAlias?: string): Promise<ProjectBinding[]> {
    const data = await this.load();
    if (!keyAlias) return data.bindings;
    const { key, alias } = VaultStore.parseKeyAlias(keyAlias);
    return data.bindings.filter(
      (b) => b.key === key && (alias === "default" || b.alias === alias)
    );
  }

  async removeBindingsForProject(projectPath: string): Promise<void> {
    const data = await this.load();
    data.bindings = data.bindings.filter((b) => b.projectPath !== projectPath);
    await this.save();
  }

  // Sync: update all bound files with current secret values
  async sync(): Promise<Array<{ file: string; key: string; success: boolean; error?: string }>> {
    const data = await this.load();
    const results: Array<{ file: string; key: string; success: boolean; error?: string }> = [];

    // Group bindings by target file
    const fileMap = new Map<string, ProjectBinding[]>();
    for (const b of data.bindings) {
      const fullPath = path.join(b.projectPath, b.file);
      const existing = fileMap.get(fullPath) || [];
      existing.push(b);
      fileMap.set(fullPath, existing);
    }

    for (const [filePath, bindings] of fileMap) {
      try {
        // Read existing file or start empty
        let content = "";
        if (await fs.pathExists(filePath)) {
          content = await fs.readFile(filePath, "utf-8");
        }

        for (const binding of bindings) {
          const value = await this.resolve(binding.key, binding.alias);
          if (value === null) {
            results.push({
              file: filePath,
              key: binding.envName || binding.key,
              success: false,
              error: "Secret not found in vault",
            });
            continue;
          }

          // Use envName if set, otherwise vault key
          const envKey = binding.envName || binding.key;
          const regex = new RegExp(`^${escapeRegex(envKey)}=.*$`, "m");
          const newLine = `${envKey}=${value}`;

          if (regex.test(content)) {
            content = content.replace(regex, newLine);
          } else {
            content = content.trimEnd() + (content.length > 0 ? "\n" : "") + newLine + "\n";
          }

          results.push({ file: filePath, key: binding.key, success: true });
        }

        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content);
      } catch (err: any) {
        for (const binding of bindings) {
          results.push({
            file: filePath,
            key: binding.key,
            success: false,
            error: err.message,
          });
        }
      }
    }

    return results;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
