// Relay Bridge Client — 内置于 okit
// 连接 Remote Relay，通过 Router 分发到不同 Adapter
//
// 架构:
//   Remote ←WebSocket→ Bridge → Router → Adapters
//     - /openclaw/** → OpenClawAdapter (openclaw agent --local)
//     - /claude/**   → ClaudeAdapter   (claude -p)
//     - /codex/**    → CodexAdapter    (codex exec)
//     - fallback     → HttpAdapter     (fetch localhost:xxx)

import WebSocket from "ws";
import os from "os";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

// ── Adapter 接口 ──

interface InboundRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface InboundResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface Adapter {
  name: string;
  match(req: InboundRequest): boolean;
  handle(req: InboundRequest): Promise<InboundResponse>;
}

// ── OpenClaw Adapter ──

class OpenClawAdapter implements Adapter {
  name = "openclaw";
  private openclawBin: string;
  private defaultCwd: string;
  private timeout: number;

  constructor(opts: { openclawBin?: string; defaultCwd?: string; timeout?: number } = {}) {
    this.openclawBin = opts.openclawBin || "openclaw";
    this.defaultCwd = opts.defaultCwd || process.cwd();
    this.timeout = opts.timeout || 600_000;
  }

  match(req: InboundRequest): boolean {
    return req.path.startsWith("/openclaw");
  }

  async handle(req: InboundRequest): Promise<InboundResponse> {
    const parts = req.path.split("/").filter(Boolean);
    const agentName = parts[1] || undefined;

    let message = "";
    let cwd = this.defaultCwd;
    try {
      const body = JSON.parse(req.body);
      message = body.message || body.text || body.content || req.body;
      if (body.cwd) cwd = body.cwd;
    } catch {
      message = req.body;
    }

    if (!message) {
      return { status: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "No message" }) };
    }

    console.log(`[openclaw] ${agentName || "default"} ← ${message.slice(0, 80)}${message.length > 80 ? "..." : ""}`);

    try {
      const result = await this.runOpenClaw(message, agentName, cwd);
      console.log(`[openclaw] ${agentName || "default"} → ${result.slice(0, 80)}${result.length > 80 ? "..." : ""}`);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, agent: agentName || "default", response: result }),
      };
    } catch (err: any) {
      return {
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Agent execution failed", detail: err.message }),
      };
    }
  }

  private runOpenClaw(message: string, agentName?: string, cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["agent", "--local", "-m", message, "--json"];
      if (agentName) args.push("--agent", agentName);
      args.push("--timeout", String(Math.floor(this.timeout / 1000)));

      const child = spawn(this.openclawBin, args, {
        cwd: cwd || this.defaultCwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Timeout`)); }, this.timeout);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          try {
            const json = JSON.parse(stdout.trim());
            resolve(json.response || json.text || json.content || stdout.trim());
          } catch {
            resolve(stdout.trim());
          }
        } else {
          reject(new Error(`Exit ${code}: ${stderr.trim()}`));
        }
      });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }
}

// ── Claude Adapter ──

class ClaudeAdapter implements Adapter {
  name = "claude";
  private claudeBin: string;
  private defaultCwd: string;
  private timeout: number;

  constructor(opts: { claudeBin?: string; defaultCwd?: string; timeout?: number } = {}) {
    this.claudeBin = opts.claudeBin || "claude";
    this.defaultCwd = opts.defaultCwd || process.cwd();
    this.timeout = opts.timeout || 600_000;
  }

  match(req: InboundRequest): boolean {
    return req.path.startsWith("/claude");
  }

  async handle(req: InboundRequest): Promise<InboundResponse> {
    const parts = req.path.split("/").filter(Boolean);
    const agentName = parts[1] || undefined;

    let message = "";
    let cwd = this.defaultCwd;
    let model: string | undefined;
    try {
      const body = JSON.parse(req.body);
      message = body.message || body.text || body.content || req.body;
      if (body.cwd) cwd = body.cwd;
      if (body.model) model = body.model;
    } catch {
      message = req.body;
    }

    if (!message) {
      return { status: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "No message" }) };
    }

    const url = new URL(`http://localhost${req.path}`);
    const resume = url.searchParams.get("resume") === "1";

    console.log(`[claude] ${agentName || "default"} ← ${message.slice(0, 80)}${message.length > 80 ? "..." : ""}`);

    try {
      const result = await this.runClaude(message, agentName, cwd, model, resume);
      console.log(`[claude] ${agentName || "default"} → ${result.slice(0, 80)}${result.length > 80 ? "..." : ""}`);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, agent: agentName || "default", response: result }),
      };
    } catch (err: any) {
      return {
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Claude execution failed", detail: err.message }),
      };
    }
  }

  private runClaude(message: string, agentName?: string, cwd?: string, model?: string, resume?: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["-p", message, "--output-format", "text"];
      if (agentName) args.push("--agent", agentName);
      if (resume) args.push("-c");
      if (model) args.push("--model", model);
      args.push("--permission-mode", "bypassPermissions");

      const child = spawn(this.claudeBin, args, {
        cwd: cwd || this.defaultCwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Timeout`)); }, this.timeout);
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(stdout.trim()) : reject(new Error(`Exit ${code}: ${stderr.trim()}`));
      });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }
}

// ── Codex Adapter ──

class CodexAdapter implements Adapter {
  name = "codex";
  private codexBin: string;
  private defaultCwd: string;
  private timeout: number;

  constructor(opts: { codexBin?: string; defaultCwd?: string; timeout?: number } = {}) {
    this.codexBin = opts.codexBin || "codex";
    this.defaultCwd = opts.defaultCwd || process.cwd();
    this.timeout = opts.timeout || 600_000;
  }

  match(req: InboundRequest): boolean {
    return req.path.startsWith("/codex");
  }

  async handle(req: InboundRequest): Promise<InboundResponse> {
    let message = "";
    let cwd = this.defaultCwd;
    let model: string | undefined;
    try {
      const body = JSON.parse(req.body);
      message = body.message || body.text || body.content || req.body;
      if (body.cwd) cwd = body.cwd;
      if (body.model) model = body.model;
    } catch {
      message = req.body;
    }

    if (!message) {
      return { status: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "No message" }) };
    }

    console.log(`[codex] ← ${message.slice(0, 80)}${message.length > 80 ? "..." : ""}`);

    try {
      const result = await this.runCodex(message, cwd, model);
      console.log(`[codex] → ${result.slice(0, 80)}${result.length > 80 ? "..." : ""}`);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, agent: "codex", response: result }),
      };
    } catch (err: any) {
      return {
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Codex execution failed", detail: err.message }),
      };
    }
  }

  private runCodex(message: string, cwd?: string, model?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["exec", message];
      if (model) args.push("-m", model);
      args.push("-s", "read-only");

      const child = spawn(this.codexBin, args, {
        cwd: cwd || this.defaultCwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Timeout`)); }, this.timeout);
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(stdout.trim()) : reject(new Error(`Exit ${code}: ${stderr.trim()}`));
      });
      child.on("error", (err) => { clearTimeout(timer); reject(err); });
    });
  }
}

// ── HTTP Adapter (fallback) ──

class HttpAdapter {
  private targetUrl: string;
  constructor(targetUrl: string) { this.targetUrl = targetUrl; }

  async handle(req: InboundRequest): Promise<InboundResponse> {
    try {
      const resp = await fetch(`${this.targetUrl}${req.path}`, {
        method: req.method || "GET",
        headers: req.headers || {},
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      });
      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => { headers[k] = v; });
      return { status: resp.status, headers, body };
    } catch (err: any) {
      return { status: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Target unreachable", detail: err.message }) };
    }
  }
}

// ── Router ──

class Router {
  private adapters: Adapter[] = [];
  private fallback: ((req: InboundRequest) => Promise<InboundResponse>) | null = null;

  use(adapter: Adapter): void { this.adapters.push(adapter); }
  setFallback(handler: (req: InboundRequest) => Promise<InboundResponse>): void { this.fallback = handler; }

  async route(req: InboundRequest): Promise<InboundResponse> {
    for (const adapter of this.adapters) {
      if (adapter.match(req)) {
        console.log(`[router] ${req.method} ${req.path} → ${adapter.name}`);
        return adapter.handle(req);
      }
    }
    if (this.fallback) {
      console.log(`[router] ${req.method} ${req.path} → fallback`);
      return this.fallback(req);
    }
    return { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "No adapter matched", path: req.path }) };
  }
}

// ── Bridge (RelayClient) ──

interface TunnelMessage {
  type: string;
  id?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  status?: number;
}

export interface RelayClientOptions {
  relayUrl: string;
  tunnelId: string;
  agentId: string;
  targetUrl?: string;
  authToken?: string;
  enableOpenClaw?: boolean;
  enableClaude?: boolean;
  enableCodex?: boolean;
  openclawBin?: string;
  claudeBin?: string;
  codexBin?: string;
  defaultCwd?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private options: RelayClientOptions;
  private router: Router;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private alive = true;
  private accessToken: string | null = null;

  constructor(options: RelayClientOptions) {
    this.options = { enableOpenClaw: true, enableClaude: true, enableCodex: true, reconnect: true, reconnectInterval: 3000, ...options };

    this.router = new Router();
    if (this.options.enableOpenClaw) {
      this.router.use(new OpenClawAdapter({
        openclawBin: this.options.openclawBin,
        defaultCwd: this.options.defaultCwd,
      }));
    }
    if (this.options.enableClaude) {
      this.router.use(new ClaudeAdapter({
        claudeBin: this.options.claudeBin,
        defaultCwd: this.options.defaultCwd,
      }));
    }
    if (this.options.enableCodex) {
      this.router.use(new CodexAdapter({
        codexBin: this.options.codexBin,
        defaultCwd: this.options.defaultCwd,
      }));
    }
    if (this.options.targetUrl) {
      const http = new HttpAdapter(this.options.targetUrl);
      this.router.setFallback((req) => http.handle(req));
    }
  }

  getAccessToken(): string | null { return this.accessToken; }

  private authHeaders(): Record<string, string> {
    if (!this.options.authToken) return {};
    return { Authorization: `Bearer ${this.options.authToken}` };
  }

  async connect(): Promise<void> {
    const wsUrl = this.options.relayUrl.replace("https://", "wss://").replace("http://", "ws://");
    const tokenParam = this.options.authToken ? `?token=${this.options.authToken}` : "";
    const connectUrl = `${wsUrl}/tunnel/${this.options.tunnelId}/connect${tokenParam}`;

    console.log(`[bridge] Connecting: ${this.options.agentId} → ${this.options.tunnelId}`);
    this.ws = new WebSocket(connectUrl);

    this.ws.on("open", async () => {
      console.log(`[bridge] Connected.`);
      console.log(`[bridge]   agent:    ${this.options.agentId}`);
      console.log(`[bridge]   tunnel:   ${this.options.tunnelId}`);
      if (this.options.targetUrl) console.log(`[bridge]   fallback: ${this.options.targetUrl}`);
      if (this.options.enableOpenClaw) console.log(`[bridge]   openclaw: enabled (/openclaw/*)`);
      if (this.options.enableClaude) console.log(`[bridge]   claude:   enabled (/claude/*)`);
      if (this.options.enableCodex) console.log(`[bridge]   codex:    enabled (/codex/*)`);
      // 等待 Tunnel DO 标记 WebSocket 为 connected
      await new Promise(r => setTimeout(r, 1000));
      await this.register();
      this.startHeartbeat();
    });

    this.ws.on("message", async (data: WebSocket.RawData) => {
      try {
        const msg: TunnelMessage = JSON.parse(data.toString());
        await this.handleMessage(msg);
      } catch (err: any) {
        console.error("[bridge] Message error:", err.message);
      }
    });

    this.ws.on("close", async (code: number, reason: Buffer) => {
      console.log(`[bridge] Disconnected (${code})`);
      this.ws = null;
      this.stopHeartbeat();
      await this.unregister().catch(() => {});
      if (this.alive && this.options.reconnect) {
        console.log(`[bridge] Reconnecting in ${this.options.reconnectInterval}ms...`);
        this.reconnectTimer = setTimeout(() => this.connect(), this.options.reconnectInterval);
      }
    });

    this.ws.on("error", (err: Error) => { console.error("[bridge] Error:", err.message); });
  }

  private async register(): Promise<void> {
    try {
      const resp = await fetch(`${this.options.relayUrl}/registry/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({
          agentId: this.options.agentId,
          tunnelId: this.options.tunnelId,
          connectedAt: new Date().toISOString(),
          metadata: {
            hostname: os.hostname(),
            platform: os.platform(),
            target: this.options.targetUrl || "bridge",
            openclaw: this.options.enableOpenClaw ? "enabled" : "disabled",
            claude: this.options.enableClaude ? "enabled" : "disabled",
            codex: this.options.enableCodex ? "enabled" : "disabled",
          },
        }),
      });
      const data = await resp.json() as any;
      if (!resp.ok) {
        console.error(`[bridge] ✗ Registration failed (${resp.status}): ${data.error}`);
        if (data.hint) console.error(`[bridge]   Hint: ${data.hint}`);
        this.accessToken = null;
        return;
      }
      this.accessToken = data.agent?.accessToken || null;
      console.log(`[bridge] ✓ Registered as: ${this.options.agentId}`);
      if (data.verified) console.log(`[bridge] ✓ Connection verified`);
      if (this.accessToken) {
        console.log(`[bridge] Access token: ${this.accessToken}`);
        this.saveAccessToken();
      }
    } catch (err: any) {
      console.error("[bridge] Registration failed:", err.message);
    }
  }

  private saveAccessToken(): void {
    if (!this.accessToken) return;
    try {
      const dir = path.join(os.homedir(), ".okit", "relay");
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "tokens.json");
      let tokens: Record<string, string> = {};
      try { tokens = JSON.parse(fs.readFileSync(f, "utf-8")); } catch {}
      tokens[this.options.agentId] = this.accessToken;
      fs.writeFileSync(f, JSON.stringify(tokens, null, 2));
    } catch {}
  }

  private async unregister(): Promise<void> {
    try {
      await fetch(`${this.options.relayUrl}/registry/unregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ agentId: this.options.agentId }),
      });
    } catch {}
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "pong" }));
      try {
        await fetch(`${this.options.relayUrl}/registry/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ agentId: this.options.agentId }),
        });
      } catch {}
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private async handleMessage(msg: TunnelMessage): Promise<void> {
    if (msg.type === "connected") return;
    if (msg.type === "ping") { this.ws?.send(JSON.stringify({ type: "pong" })); return; }
    if (msg.type !== "request" || !msg.id) return;

    const response = await this.router.route({
      id: msg.id,
      method: msg.method || "GET",
      path: msg.path || "/",
      headers: msg.headers || {},
      body: msg.body || "",
    });

    this.ws?.send(JSON.stringify({
      type: "response",
      id: msg.id,
      status: response.status,
      headers: response.headers,
      body: response.body,
    }));
  }

  async disconnect(): Promise<void> {
    this.alive = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.unregister().catch(() => {});
    if (this.ws) { this.ws.close(1000, "disconnect"); this.ws = null; }
  }
}
