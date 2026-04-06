// Relay Client — 内置于 okit，连接任意中继服务器
// 协议：WebSocket 双向通信 + HTTP 请求转发

import WebSocket from "ws";
import os from "os";
import fs from "fs";
import path from "path";

interface TunnelMessage {
  type: string;
  id?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  status?: number;
  tunnelId?: string;
  message?: string;
}

export interface RelayClientOptions {
  relayUrl: string;
  tunnelId: string;
  agentId: string;
  targetUrl: string;
  authToken?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private options: RelayClientOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private alive = true;
  private accessToken: string | null = null;

  constructor(options: RelayClientOptions) {
    this.options = {
      reconnect: true,
      reconnectInterval: 3000,
      ...options,
    };
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private authHeaders(): Record<string, string> {
    if (!this.options.authToken) return {};
    return { Authorization: `Bearer ${this.options.authToken}` };
  }

  async connect(): Promise<void> {
    const wsUrl = this.options.relayUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://");

    const tokenParam = this.options.authToken ? `?token=${this.options.authToken}` : "";
    const connectUrl = `${wsUrl}/tunnel/${this.options.tunnelId}/connect${tokenParam}`;

    console.log(`[relay] Connecting: ${this.options.agentId} → ${this.options.tunnelId}`);

    this.ws = new WebSocket(connectUrl);

    this.ws.on("open", async () => {
      console.log(`[relay] Connected.`);
      console.log(`[relay]   agent:    ${this.options.agentId}`);
      console.log(`[relay]   tunnel:   ${this.options.tunnelId}`);
      console.log(`[relay]   target:   ${this.options.targetUrl}`);

      await this.register();
      this.startHeartbeat();
    });

    this.ws.on("message", async (data: WebSocket.RawData) => {
      try {
        const msg: TunnelMessage = JSON.parse(data.toString());
        await this.handleMessage(msg);
      } catch (err: any) {
        console.error("[relay] Failed to handle message:", err.message);
      }
    });

    this.ws.on("close", async (code: number, reason: Buffer) => {
      console.log(`[relay] Disconnected (${code}: ${reason?.toString() || "no reason"})`);
      this.ws = null;
      this.stopHeartbeat();

      await this.unregister().catch(() => {});

      if (this.alive && this.options.reconnect) {
        console.log(`[relay] Reconnecting in ${this.options.reconnectInterval}ms...`);
        this.reconnectTimer = setTimeout(() => this.connect(), this.options.reconnectInterval);
      }
    });

    this.ws.on("error", (err: Error) => {
      console.error("[relay] WebSocket error:", err.message);
    });
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
            target: this.options.targetUrl,
          },
        }),
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        this.accessToken = data.agent?.accessToken || null;
        console.log(`[relay] Registered as: ${this.options.agentId}`);
        if (this.accessToken) {
          console.log(`[relay] Access token: ${this.accessToken}`);
          console.log(`[relay] External call:`);
          console.log(`[relay]   curl ${this.options.relayUrl}/agent/${this.options.agentId}/ -H "Authorization: Bearer ${this.accessToken}"`);
          this.saveAccessToken();
        }
      }
    } catch (err: any) {
      console.error("[relay] Registration failed:", err.message);
    }
  }

  private saveAccessToken(): void {
    if (!this.accessToken) return;
    try {
      const dir = path.join(os.homedir(), ".okit", "relay");
      fs.mkdirSync(dir, { recursive: true });
      const tokensFile = path.join(dir, "tokens.json");
      let tokens: Record<string, string> = {};
      try {
        tokens = JSON.parse(fs.readFileSync(tokensFile, "utf-8"));
      } catch {}
      tokens[this.options.agentId] = this.accessToken;
      fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
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
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "pong" }));
      }
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
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async handleMessage(msg: TunnelMessage): Promise<void> {
    if (msg.type === "connected") return;

    if (msg.type === "ping") {
      this.ws?.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type !== "request" || !msg.id) return;

    const { id, method, path: reqPath, headers, body } = msg;
    const targetUrl = `${this.options.targetUrl}${reqPath}`;

    console.log(`[relay] → ${method} ${reqPath}`);

    try {
      const resp = await fetch(targetUrl, {
        method: method || "GET",
        headers: headers || {},
        body: method !== "GET" && method !== "HEAD" ? body : undefined,
      });

      const respBody = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((value: string, key: string) => {
        respHeaders[key] = value;
      });

      this.ws?.send(JSON.stringify({
        type: "response",
        id,
        status: resp.status,
        headers: respHeaders,
        body: respBody,
      }));
      console.log(`[relay] ← ${resp.status} ${method} ${reqPath}`);
    } catch (err: any) {
      this.ws?.send(JSON.stringify({
        type: "response",
        id,
        status: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Local target error", detail: err.message }),
      }));
      console.error(`[relay] ✗ ${method} ${reqPath}: ${err.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.alive = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.unregister().catch(() => {});
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
  }
}
