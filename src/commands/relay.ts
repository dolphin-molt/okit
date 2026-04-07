import kleur from "kleur";
import prompts from "prompts";
import path from "path";
import { loadUserConfig, updateUserConfig } from "../config/user";
import { t } from "../config/i18n";
import { RelayClient } from "../relay/client";

async function getRelayConfig(): Promise<{ url: string; token: string } | null> {
  const config = await loadUserConfig();
  if (!config.relay?.url || !config.relay?.token) {
    return null;
  }
  return { url: config.relay.url, token: config.relay.token };
}

function printConfigHint(): void {
  console.log(kleur.yellow(t("relayNotConfigured")));
  console.log(kleur.gray("  okit relay config --url <relay-url> --token <auth-token>"));
}

// okit relay config
export async function relayConfig(options: { url?: string; token?: string }): Promise<void> {
  let url = options.url;
  let token = options.token;

  if (!url && !token) {
    // Interactive mode
    const current = await loadUserConfig();
    const res = await prompts([
      {
        type: "text",
        name: "url",
        message: t("relayConfigUrl"),
        initial: current.relay?.url || "",
      },
      {
        type: "password",
        name: "token",
        message: t("relayConfigToken"),
        initial: current.relay?.token || "",
      },
    ]);
    url = res.url;
    token = res.token;
  }

  if (url || token) {
    const patch: any = {};
    if (url) patch.url = url;
    if (token) patch.token = token;
    await updateUserConfig({ relay: patch });
    console.log(kleur.green(t("relayConfigSaved")));

    const config = await loadUserConfig();
    if (config.relay?.url) {
      console.log(kleur.gray(`  url:   ${config.relay.url}`));
    }
    if (config.relay?.token) {
      console.log(kleur.gray(`  token: ${"*".repeat(8)}`));
    }
  }
}

// okit relay connect
export async function relayConnect(options: {
  tunnel: string;
  agent: string;
  target?: string;
  daemon?: boolean;
}): Promise<void> {
  const config = await getRelayConfig();
  if (!config) {
    printConfigHint();
    return;
  }

  const target = options.target || "http://localhost:3000";

  if (options.daemon) {
    return relayConnectDaemon(options.tunnel, options.agent, target, config);
  }

  const client = new RelayClient({
    relayUrl: config.url,
    tunnelId: options.tunnel,
    agentId: options.agent,
    targetUrl: target,
    authToken: config.token,
  });

  const cleanup = async () => {
    console.log("\n[relay] Shutting down...");
    await client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await client.connect();

  // 保持进程运行
  return new Promise(() => {});
}

async function relayConnectDaemon(
  tunnel: string, agent: string, target: string,
  config: { url: string; token: string }
): Promise<void> {
  const { spawn } = await import("child_process");
  const fs = await import("fs-extra");

  const logDir = path.join(process.env.HOME || "~", ".okit", "relay");
  await fs.ensureDir(logDir);
  const logFile = path.join(logDir, `${agent}.log`);
  const pidFile = path.join(logDir, `${agent}.pid`);

  // 检查是否已有同名守护进程
  if (await fs.pathExists(pidFile)) {
    const oldPid = (await fs.readFile(pidFile, "utf-8")).trim();
    try {
      process.kill(Number(oldPid), 0); // 检查进程是否存在
      console.log(kleur.yellow(`[relay] Agent "${agent}" already running (PID ${oldPid})`));
      console.log(kleur.gray(`  Log: ${logFile}`));
      console.log(kleur.gray(`  Stop: okit relay stop ${agent}`));
      return;
    } catch {
      // 进程不存在，清理旧 pid 文件
    }
  }

  // 去掉代理环境变量，避免 fetch 请求被代理拦截返回 HTML
  const cleanEnv = { ...process.env };
  delete cleanEnv.HTTP_PROXY;
  delete cleanEnv.HTTPS_PROXY;
  delete cleanEnv.http_proxy;
  delete cleanEnv.https_proxy;

  // 确保 PATH 包含常用 bin 目录（daemon 可能继承精简 PATH）
  const extraPaths = [
    path.join(process.env.HOME || "~", ".npm-global", "bin"),
    path.join(process.env.HOME || "~", ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const currentPath = cleanEnv.PATH || "";
  const missingPaths = extraPaths.filter((p) => !currentPath.includes(p));
  if (missingPaths.length) {
    cleanEnv.PATH = [...missingPaths, currentPath].join(":");
  }

  const logFd = fs.openSync(logFile, "a");
  let childPid: number | undefined;
  try {
    const child = spawn(process.execPath, [
      process.argv[1],
      "relay", "connect",
      "--tunnel", tunnel,
      "--agent", agent,
      "--target", target,
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: cleanEnv,
    });

    child.unref();
    childPid = child.pid;
    await fs.writeFile(pidFile, String(childPid));
  } finally {
    fs.closeSync(logFd);
  }

  console.log(kleur.green(`[relay] ✓ Daemon started: ${agent} (PID ${childPid})`));
  console.log(kleur.gray(`  Log:  ${logFile}`));
  console.log(kleur.gray(`  Stop: okit relay stop ${agent}`));
}

// okit relay stop <agent-name>
export async function relayStop(agentName: string): Promise<void> {
  const fs = await import("fs-extra");
  const pidFile = path.join(process.env.HOME || "~", ".okit", "relay", `${agentName}.pid`);

  if (!await fs.pathExists(pidFile)) {
    console.log(kleur.yellow(`[relay] No daemon found for "${agentName}"`));
    return;
  }

  const pid = Number((await fs.readFile(pidFile, "utf-8")).trim());
  try {
    process.kill(pid, "SIGTERM");
    // 等待进程退出（最多 5s），让 unregister 完成
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(kleur.green(`[relay] ✓ Stopped ${agentName} (PID ${pid})`));
  } catch {
    console.log(kleur.yellow(`[relay] Process ${pid} not running, cleaning up`));
  }
  await fs.remove(pidFile);
}

// okit relay ps — 列出所有运行中的守护进程
export async function relayPs(): Promise<void> {
  const fs = await import("fs-extra");
  const dir = path.join(process.env.HOME || "~", ".okit", "relay");

  if (!await fs.pathExists(dir)) {
    console.log(kleur.yellow("[relay] No daemons"));
    return;
  }

  const files = (await fs.readdir(dir)).filter((f: string) => f.endsWith(".pid"));
  if (files.length === 0) {
    console.log(kleur.yellow("[relay] No daemons running"));
    return;
  }

  // 读取 token 和配置用于显示
  let tokens: Record<string, string> = {};
  const tokensFile = path.join(dir, "tokens.json");
  try { tokens = await fs.readJson(tokensFile); } catch {}

  const config = await getRelayConfig();

  console.log(kleur.cyan(`\n[relay] Bridges (${files.length})\n`));
  for (const f of files) {
    const name = f.replace(".pid", "");
    const pid = Number((await fs.readFile(path.join(dir, f), "utf-8")).trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch {}
    const status = alive ? kleur.green("● running") : kleur.red("✗ dead");
    console.log(`  ${kleur.bold(name)}  PID ${pid}  ${status}`);
    if (config) {
      console.log(kleur.gray(`    relay:  ${config.url}`));
    }
    const token = tokens[name];
    if (token) {
      console.log(kleur.gray(`    token:  ${token.slice(0, 12)}...`));
    }
    // 读取日志最后几行获取连接信息
    const logFile = path.join(dir, `${name}.log`);
    if (await fs.pathExists(logFile)) {
      console.log(kleur.gray(`    log:    ${logFile}`));
    }
    if (!alive) {
      console.log(kleur.gray(`    cleanup: okit relay stop ${name}`));
    } else {
      console.log(kleur.gray(`    stop:   okit relay stop ${name}`));
    }
    console.log();
  }
}

// okit relay logs <agent-name> — 查看 bridge 日志
export async function relayLogs(agentName: string, options: { follow?: boolean; lines?: number }): Promise<void> {
  const fs = await import("fs-extra");
  const { spawn: spawnProc } = await import("child_process");
  const logFile = path.join(process.env.HOME || "~", ".okit", "relay", `${agentName}.log`);

  if (!await fs.pathExists(logFile)) {
    console.log(kleur.yellow(`[relay] No log file for "${agentName}"`));
    return;
  }

  const lines = options.lines || 50;

  const tailArgs = options.follow
    ? ["-f", "-n", String(lines), logFile]
    : ["-n", String(lines), logFile];

  const child = spawnProc("tail", tailArgs, { stdio: "inherit" });

  if (options.follow) {
    process.on("SIGINT", () => { child.kill(); process.exit(0); });
    await new Promise(() => {}); // 保持运行
  } else {
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
  }
}

// okit relay status
export async function relayStatus(tunnel: string): Promise<void> {
  const config = await getRelayConfig();
  if (!config) { printConfigHint(); return; }

  try {
    const resp = await fetch(`${config.url}/tunnel/${tunnel}/status`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await resp.json() as any;
    console.log(kleur.cyan(`\n[relay] Tunnel: ${tunnel}`));
    console.log(`  connected:       ${data.connected ? kleur.green("yes") : kleur.red("no")}`);
    console.log(`  pendingRequests: ${data.pendingRequests}`);
    console.log(`  logSubscribers:  ${data.logSubscribers}`);
    console.log();
  } catch (err: any) {
    console.log(kleur.red(`[relay] Failed: ${err.message}`));
  }
}

// okit relay create
export async function relayCreate(tunnel?: string): Promise<void> {
  const config = await getRelayConfig();
  if (!config) { printConfigHint(); return; }

  try {
    const body = tunnel ? JSON.stringify({ id: tunnel }) : "{}";
    const resp = await fetch(`${config.url}/tunnel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body,
    });
    const data = await resp.json() as any;

    if (data.error) {
      console.log(kleur.red(`[relay] ${data.error}`));
      return;
    }

    console.log(kleur.cyan(`\n[relay] Tunnel created: ${data.tunnelId}\n`));
    console.log(`  proxy:   ${kleur.gray(data.endpoints.proxy)}`);
    console.log(`  agent:   ${kleur.gray(data.endpoints.agent)}`);
    console.log(`  status:  ${kleur.gray(data.endpoints.status)}`);
    console.log();
    console.log(kleur.gray(`  okit relay connect --tunnel ${data.tunnelId} --agent my-agent`));
    console.log();
  } catch (err: any) {
    console.log(kleur.red(`[relay] Failed: ${err.message}`));
  }
}

// okit relay agents — list all online agents
export async function relayAgents(): Promise<void> {
  const config = await getRelayConfig();
  if (!config) { printConfigHint(); return; }

  try {
    const resp = await fetch(`${config.url}/registry/agents`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await resp.json() as any;

    if (data.count === 0) {
      console.log(kleur.yellow(t("relayNoAgents")));
      return;
    }

    console.log(kleur.cyan(`\n${t("relayAgentList")} (${data.count})\n`));
    for (const agent of data.agents) {
      const uptime = timeSince(agent.connectedAt);
      const lastSeen = timeSince(agent.lastSeen);
      console.log(`  ${kleur.green("\u2713")} ${kleur.bold(agent.agentId)}`);
      console.log(kleur.gray(`    tunnel: ${agent.tunnelId}  uptime: ${uptime}  last: ${lastSeen} ago`));
      if (agent.metadata) {
        const meta = Object.entries(agent.metadata).map(([k, v]) => `${k}=${v}`).join("  ");
        console.log(kleur.gray(`    ${meta}`));
      }
    }
    console.log();
  } catch (err: any) {
    console.log(kleur.red(`[relay] Failed: ${err.message}`));
  }
}

// okit relay token rotate <agent-name> — 轮换 token
export async function relayTokenRotate(agentName: string): Promise<void> {
  const config = await getRelayConfig();
  if (!config) { printConfigHint(); return; }

  try {
    const resp = await fetch(`${config.url}/registry/rotate/${agentName}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await resp.json() as any;

    if (!resp.ok) {
      console.log(kleur.red(`[relay] ✗ ${data.error || "Rotate failed"}`));
      return;
    }

    // 更新本地存储
    const fs = await import("fs-extra");
    const tokensFile = path.join(process.env.HOME || "~", ".okit", "relay", "tokens.json");
    let tokens: Record<string, string> = {};
    try { tokens = await fs.readJson(tokensFile); } catch {}
    tokens[agentName] = data.accessToken;
    await fs.ensureDir(path.dirname(tokensFile));
    await fs.writeJson(tokensFile, tokens, { spaces: 2 });

    console.log(kleur.green(`[relay] ✓ Token rotated for ${agentName}`));
    console.log(kleur.gray(`  New token: ${data.accessToken}`));
    console.log(kleur.yellow(`  ⚠ 所有使用旧 token 的外部调用者需要更新`));
  } catch (err: any) {
    console.log(kleur.red(`[relay] Failed: ${err.message}`));
  }
}

// okit relay token <agent-name> — 查询 per-agent access token
export async function relayToken(agentName?: string): Promise<void> {
  const fs = await import("fs-extra");
  const tokensFile = path.join(process.env.HOME || "~", ".okit", "relay", "tokens.json");

  if (!await fs.pathExists(tokensFile)) {
    console.log(kleur.yellow("没有已保存的 agent token，请先运行 okit relay connect"));
    return;
  }

  const tokens: Record<string, string> = await fs.readJson(tokensFile);

  if (!agentName) {
    // 列出所有
    const entries = Object.entries(tokens);
    if (entries.length === 0) {
      console.log(kleur.yellow("没有已保存的 agent token"));
      return;
    }
    console.log(kleur.cyan(`\n[relay] Saved tokens (${entries.length})\n`));
    for (const [name, token] of entries) {
      console.log(`  ${kleur.bold(name)}: ${kleur.gray(token)}`);
    }
    console.log();
    return;
  }

  const token = tokens[agentName];
  if (!token) {
    console.log(kleur.yellow(`未找到 agent "${agentName}" 的 token`));
    console.log(kleur.gray(`已有: ${Object.keys(tokens).join(", ") || "无"}`));
    return;
  }

  // 直接输出原始值，方便管道使用
  process.stdout.write(token);
}

function timeSince(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
