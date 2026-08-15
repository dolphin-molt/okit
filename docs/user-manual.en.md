# OKIT User Manual

OKIT is the key and model control plane for AI agents: a local encrypted vault, 29+ built-in providers, adapters for 8 agents, and usage dashboards for 15 platforms. With the browser extension you can **auto-create API keys in one click**.

---

## 1. Install & Launch

**NPM (recommended):**

```bash
npm install -g @cing-self/okit-cli
```

**Install script:**

```bash
curl -fsSL https://raw.githubusercontent.com/dolphin-molt/okit/refs/heads/main/install.sh | bash
```

**Start the web dashboard:**

```bash
okit            # interactive menu
okit web        # start the web dashboard
```

The dashboard runs at **http://localhost:3780** by default. If port 3780 is taken, OKIT automatically tries 3781, 3782… — the actual address is printed in the startup log.

> ⚠️ **To use the browser extension (auto-create keys), OKIT must run on port 3780.** The current extension hardcodes `ws://localhost:3780/ws/extension`; if OKIT lands on 3781 or beyond, the extension cannot connect. If that happens, free port 3780 and restart OKIT.

---

## 2. Dashboard Overview

| Page | Purpose |
|------|---------|
| Quick Start | Home cockpit: agent switching, provider toggles, today's usage |
| AI Assistant | Built-in assistant that acts on your keys/providers/usage |
| Vault | Encrypted key vault: manual add, auto-create, project binding, cloud sync |
| Models | 29+ provider presets: endpoints, auth, model catalogs, plans |
| Usage | Subscription/balance queries with alerts for 15 providers |
| Agent Config | Config adapters and one-click model switching for 8 agents |
| Settings | Language, cloud sync, ports, etc. |

---

## 3. Browser Extension Setup (prerequisite for auto-create)

The **OKIT Auto-Create** extension (MV3) reuses your logged-in Chrome sessions: it fills the forms on provider consoles, creates the key, copies it, and files it back into the OKIT vault — entirely between your browser and your machine.

### 3.1 Build the extension

The extension source lives in `extension/`; build it first:

```bash
cd extension
npm install
npm run build        # tsc compile → extension/dist/
```

### 3.2 Load into Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` directory (the `dist` subdirectory, not the `extension` root)

"OKIT Auto-Create" appears in the extension list once loaded.

### 3.3 Verify the connection

1. Start OKIT (`okit web`, confirm it is on port 3780)
2. The extension connects automatically via WebSocket to `ws://localhost:3780/ws/extension`
3. The OKIT log line `[WS] Extension hello: v2.x.x protocol=...` means the connection succeeded
4. You can also check the extension status from **Vault → Auto-create**

### 3.4 Permissions (important)

The extension requests `debugger`, `tabs`, `cookies`, and related permissions, so Chrome shows a banner — **"OKIT Auto-Create started debugging this browser"** — **this is expected**: the extension needs the debugger channel to read pages and perform clicks. Debugging happens only between your local OKIT and your browser; nothing is sent to external servers.

### 3.5 Updating the extension

- After code changes: run `npm run build` again, then click 🔄 on the extension card in `chrome://extensions/`
- If `manifest.json` `permissions` changed: you must **remove the extension → Load unpacked again**; refreshing alone is not enough

---

## 4. Auto-creating Keys

### 4.1 Prerequisites

- Extension installed and connected (section 3)
- **Chrome is logged in to the target platform** (auto-create reuses your session)

### 4.2 Flow

1. Dashboard → **Vault** → **Auto-create**
2. Pick a platform (31 supported, see table below)
3. OKIT opens a browser window, navigates to the platform's API key page, fills in a name, clicks create, and copies the new key
4. The key is written into the local encrypted vault (AES-256-GCM); plaintext never touches disk

### 4.3 Supported platforms

| Group | Platforms |
|-------|-----------|
| International | OpenAI, Anthropic, Cloudflare, xAI (Grok), Mistral, OpenRouter |
| Zhipu | Zhipu AI (CN), Z.AI (global) |
| Volcengine | Volcengine, Volcengine Agent Plan |
| Tencent Cloud | Tencent Cloud, Tencent Cloud Token Plan |
| MiniMax | MiniMax CN/global, MiniMax Token Plan CN/global |
| Moonshot | Moonshot, Moonshot Coding Plan, Kimi (CN), Kimi (global) |
| Alibaba Cloud | Bailian, Bailian Coding Plan, Bailian Token Plan |
| Baidu | Qianfan, Qianfan Token Plan |
| Others | DeepSeek, SiliconFlow, Xiaomi MiMo (+ Token Plan), StepFun, OpenCode Go |

### 4.4 Special cases

- **Volcengine**: the platform may pop up a security or SMS verification mid-flow; complete it manually and the extension takes over again (semi-automatic)
- **Z.AI / Baidu Qianfan Token Plan**: plaintext is read via the list page's "copy" control; if the control does not return plaintext, OKIT stops and asks you to copy manually — it would rather store nothing than store a masked value
- **Anthropic**: keep the browser in the foreground after creation; the extension reads the key via the "Copy" button

---

## 5. Everyday Vault Usage

- **Manual add**: Vault → Add, name + key, optional usage note
- **Project binding**: keys bind to project directories; OKIT injects them into that project's `.env` (e.g. `OPENAI_API_KEY`), matched by key name
- **Cloud sync**: end-to-end encrypted via Cloudflare KV. After configuring it in Settings:
  ```bash
  okit vault push     # push keys to the cloud
  okit vault pull     # pull from the cloud
  ```
  The cloud only ever stores ciphertext; the master key never leaves your machine.

---

## 6. Providers & Agent Config

- The **Models** page ships 29+ provider presets (official APIs, aggregators, Chinese platforms); click a card to configure endpoints and auth; the ⋯ menu offers "Connect" (test + fetch model list)
- **Agent Config** supports 8 agents: Claude Code, ChatGPT (Codex), Kimi Code, WorkBuddy, Hermes, OpenCode, OpenClaw, ZCode
- Switching models: Quick Start → pick the agent → flip the provider switch → click a model chip; config files (`config.toml`, `auth.json`, …) are written correctly for you
- Provider configs support import/export for cross-device migration

---

## 7. Usage Tracking

- The **Usage** page shows remaining quota per window (5h/weekly/monthly) and prepaid balances for each provider
- Smart polling refreshes automatically; remaining ≤30% turns amber, ≤10% turns red and fires a browser notification
- The Quick Start home page also carries a today's-usage summary strip

---

## 8. CLI Cheat Sheet

```bash
okit                    # interactive menu
okit web                # start the web dashboard
okit vault              # key management
okit vault push         # encrypted sync to the cloud
okit vault pull         # pull from the cloud
okit auth               # check tool auth status
okit upgrade            # upgrade OKIT
okit -V                 # version
```

---

## 9. FAQ

**Q: The extension is installed but won't connect.**
Make sure OKIT runs on port 3780 (check the startup log). The extension hardcodes 3780; if OKIT is on 3781+, the extension cannot connect.

**Q: Can I dismiss Chrome's "debugging this browser" banner?**
Closing it disconnects the extension. The banner is Chrome's mandatory notice for the debugger permission — it is expected; keep it on.

**Q: Auto-create stopped halfway.**
Usually the platform popped up a verification (security/SMS). Complete it manually and the flow continues; or restart auto-create.

**Q: Why can't I see the full key in the vault?**
Keys are stored AES-256-GCM encrypted and masked in the UI. Bound projects get the plaintext injected at runtime; you can also reveal the full value when needed.

**Q: Windows / Linux support?**
Yes. OKIT and the extension run on macOS, Linux, and Windows.
