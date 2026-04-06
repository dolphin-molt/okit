import kleur from "kleur";
import prompts from "prompts";
import { spawn } from "child_process";
import path from "path";
import { loadUserConfig, updateUserConfig } from "../config/user";
import { t } from "../config/i18n";

const RELAY_PROJECT = path.join(process.env.HOME || "~", "Desktop/Dolphin/relay");

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
}): Promise<void> {
  const config = await getRelayConfig();
  if (!config) {
    printConfigHint();
    return;
  }

  const target = options.target || "http://localhost:3000";

  console.log(kleur.cyan(`\n[relay] Connecting`));
  console.log(kleur.gray(`  agent:    ${options.agent}`));
  console.log(kleur.gray(`  tunnel:   ${options.tunnel}`));
  console.log(kleur.gray(`  target:   ${target}`));
  console.log(kleur.gray(`  external: ${config.url}/agent/${options.agent}/\n`));

  const child = spawn(
    "npx",
    [
      "tsx", "src/client.ts",
      "--relay", config.url,
      "--tunnel", options.tunnel,
      "--agent", options.agent,
      "--target", target,
      "--token", config.token,
    ],
    {
      cwd: RELAY_PROJECT,
      stdio: "inherit",
      env: { ...process.env },
    }
  );

  const cleanup = () => { child.kill("SIGTERM"); };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return new Promise((resolve) => {
    child.on("close", () => {
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
      resolve();
    });
  });
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
