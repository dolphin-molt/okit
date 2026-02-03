import execa from "execa";
import fs from "fs-extra";
import path from "path";
import prompts from "prompts";
import kleur from "kleur";
import { t } from "../config/i18n";
import { loadUserConfig, updateUserConfig } from "../config/user";

type RepoProvider = "github";

export async function showRepoMenu(): Promise<void> {
  while (true) {
    const response = await prompts({
      type: "select",
      name: "action",
      message: t("repoSelectAction"),
      choices: [
        { title: t("repoCreate"), value: "create" },
        { title: t("repoSetup"), value: "setup" },
        { title: t("back"), value: "back" },
      ],
    });

    if (response.action === "back" || !response.action) return;
    if (response.action === "create") {
      await createRepositoryFlow();
    } else if (response.action === "setup") {
      await configureRepoSetup();
    }
  }
}

export async function createRepositoryFlow(): Promise<void> {
  const provider: RepoProvider = "github";

  const repoName = await promptRepoName();
  if (!repoName) return;

  const isPrivate = await promptRepoVisibility();
  const shouldInit = await promptYesNo(t("repoInitGit"), true);
  const shouldPush = await promptYesNo(t("repoFirstPush"), true);

  if (shouldInit) {
    await ensureGitRepo();
  }

  const usedGh = await tryCreateRepoWithGh(repoName, isPrivate, shouldPush);
  if (usedGh) return;
  const ok = await ensureGithubToken();
  if (!ok) return;
  const result = await createRepoWithGithubApi(repoName, isPrivate);
  if (result.status === "exists") {
    const handled = await handleExistingRepo(provider, repoName, shouldPush);
    if (!handled) return;
  } else {
    await setOriginRemote(provider, repoName);
    if (shouldPush) {
      await pushToOrigin();
    }
  }
}

async function configureRepoSetup(): Promise<void> {
  const response = await prompts([
    { type: "text", name: "name", message: t("repoGitName") },
    { type: "text", name: "email", message: t("repoGitEmail") },
    { type: "text", name: "username", message: t("repoUsername") },
    { type: "password", name: "token", message: t("repoToken") },
  ]);

  if (!response.name || !response.email || !response.username || !response.token) {
    console.log(kleur.gray(t("repoCancelled")));
    return;
  }

  await updateUserConfig({
    git: { name: response.name, email: response.email },
    repo: { github: { username: response.username, token: response.token } },
  });

  const scopeResponse = await prompts({
    type: "select",
    name: "scope",
    message: t("repoGitScope"),
    choices: [
      { title: t("repoGitScopeGlobal"), value: "global" },
      { title: t("repoGitScopeLocal"), value: "local" },
    ],
  });

  const args = scopeResponse.scope === "local" ? [] : ["--global"];
  await execa.command(`git config ${args.join(" ")} user.name "${response.name}"`, {
    shell: true,
  });
  await execa.command(`git config ${args.join(" ")} user.email "${response.email}"`, {
    shell: true,
  });

  await storeHttpsCredential("github", response.username, response.token);
  console.log(kleur.green(t("repoSetupSaved")));
}

async function promptRepoName(): Promise<string | undefined> {
  const cwd = process.cwd();
  const defaultName = path.basename(cwd);
  const response = await prompts({
    type: "text",
    name: "name",
    message: t("repoName"),
    initial: defaultName,
  });
  if (!response.name) return undefined;
  return String(response.name).trim();
}

async function promptRepoVisibility(): Promise<boolean> {
  const response = await prompts({
    type: "select",
    name: "visibility",
    message: t("repoVisibility"),
    choices: [
      { title: t("repoPrivate"), value: "private" },
      { title: t("repoPublic"), value: "public" },
    ],
  });
  return response.visibility === "private";
}

async function promptYesNo(message: string, initial: boolean): Promise<boolean> {
  const response = await prompts({
    type: "toggle",
    name: "value",
    message,
    initial,
    active: t("repoYes"),
    inactive: t("repoNo"),
  });
  return Boolean(response.value);
}

async function ensureGitRepo(): Promise<void> {
  if (await fs.pathExists(path.join(process.cwd(), ".git"))) return;
  await execa.command("git init", { shell: true, stdio: "inherit" });
}

async function tryCreateRepoWithGh(
  name: string,
  isPrivate: boolean,
  shouldPush: boolean
): Promise<boolean> {
  if (!(await commandExists("gh"))) return false;
  try {
    const visibility = isPrivate ? "--private" : "--public";
    const pushFlag = shouldPush ? "--push" : "";
    const cmd = `gh repo create ${name} ${visibility} --source . --remote origin ${pushFlag}`.trim();
    await execa.command(cmd, { shell: true, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

async function ensureGithubToken(): Promise<boolean> {
  const config = await loadUserConfig();
  if (config.repo?.github?.token && config.repo?.github?.username) return true;
  console.log(kleur.yellow(t("repoNeedAuth")));
  await configureRepoSetup();
  const updated = await loadUserConfig();
  return Boolean(updated.repo?.github?.token && updated.repo?.github?.username);
}

type CreateRepoResult = { status: "created" | "exists" };

async function createRepoWithGithubApi(name: string, isPrivate: boolean): Promise<CreateRepoResult> {
  const config = await loadUserConfig();
  const token = config.repo?.github?.token;
  if (!token) throw new Error("Missing GitHub token");
  const payload = JSON.stringify({ name, private: isPrivate });
  const { stdout } = await execa.command(
    `curl -s -w "\\n%{http_code}" -X POST https://api.github.com/user/repos -H "Authorization: token ${token}" -d '${payload}'`,
    { shell: true }
  );
  const parsed = parseCurlResponse(stdout);
  if (parsed.statusCode === 201) return { status: "created" };
  if (parsed.statusCode === 422 && isRepoExistsMessage(parsed.body)) {
    console.log(kleur.yellow(t("repoExists")));
    return { status: "exists" };
  }
  throw new Error(parsed.body || "Failed to create GitHub repo");
}

async function createRepoWithGiteeApi(name: string, isPrivate: boolean): Promise<CreateRepoResult> {
  const config = await loadUserConfig();
  const token = config.repo?.gitee?.token;
  if (!token) throw new Error("Missing Gitee token");
  const payload = JSON.stringify({ name, private: isPrivate });
  const { stdout } = await execa.command(
    `curl -s -w "\\n%{http_code}" -X POST https://gitee.com/api/v5/user/repos?access_token=${token} -H "Content-Type: application/json" -d '${payload}'`,
    { shell: true }
  );
  const parsed = parseCurlResponse(stdout);
  if (parsed.statusCode === 201) return { status: "created" };
  if ((parsed.statusCode === 400 || parsed.statusCode === 409) && isRepoExistsMessage(parsed.body)) {
    console.log(kleur.yellow(t("repoExists")));
    return { status: "exists" };
  }
  throw new Error(parsed.body || "Failed to create Gitee repo");
}

async function setOriginRemote(provider: RepoProvider, name: string): Promise<void> {
  const config = await loadUserConfig();
  const username =
    provider === "github" ? config.repo?.github?.username : config.repo?.gitee?.username;
  if (!username) throw new Error("Missing username");
  const remote =
    provider === "github"
      ? `https://github.com/${username}/${name}.git`
      : `https://gitee.com/${username}/${name}.git`;
  try {
    await execa.command(`git remote add origin ${remote}`, { shell: true, stdio: "inherit" });
  } catch {
    await execa.command(`git remote set-url origin ${remote}`, { shell: true, stdio: "inherit" });
  }
}

async function pushToOrigin(): Promise<void> {
  await execa.command("git branch -M main", { shell: true, stdio: "inherit" });
  await execa.command("git push -u origin main", { shell: true, stdio: "inherit" });
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execa.command(`command -v ${command}`, { shell: true });
    return true;
  } catch {
    return false;
  }
}

async function handleExistingRepo(
  provider: RepoProvider,
  name: string,
  shouldPush: boolean
): Promise<boolean> {
  const useExisting = await promptYesNo(t("repoUseExisting"), true);
  if (!useExisting) {
    console.log(kleur.gray(t("repoCancelled")));
    return false;
  }
  await setOriginRemote(provider, name);
  if (shouldPush) {
    await pushToOrigin();
  }
  return true;
}

function parseCurlResponse(output: string): { body: string; statusCode: number } {
  const trimmed = String(output ?? "").trim();
  const lastNewline = trimmed.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { body: trimmed, statusCode: 0 };
  }
  const body = trimmed.slice(0, lastNewline).trim();
  const statusCode = Number(trimmed.slice(lastNewline + 1).trim());
  return { body, statusCode: Number.isNaN(statusCode) ? 0 : statusCode };
}

function isRepoExistsMessage(body: string): boolean {
  const text = body.toLowerCase();
  return (
    text.includes("already exists") ||
    text.includes("name already exists") ||
    text.includes("已存在") ||
    text.includes("已被占用") ||
    text.includes("repo name already exists")
  );
}

async function storeHttpsCredential(
  provider: RepoProvider,
  username: string,
  token: string
): Promise<void> {
  const host = "github.com";
  try {
    await execa.command("git config --global credential.helper osxkeychain", { shell: true });
    const payload = `protocol=https\nhost=${host}\nusername=${username}\npassword=${token}\n\n`;
    await execa.command("git credential approve", { shell: true, input: payload });
  } catch {
    // 失败时不阻断主流程（例如系统未启用 keychain）
  }
}
