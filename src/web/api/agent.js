const os = require('os');
const fs = require('fs');
const path = require('path');
const execa = require('execa');
const fse = require('fs-extra');
const { z } = require('zod');
const { redactLog } = require('./logs');

const agentSessions = new Map();

// ─── Pi Agent Kernel (lazy-loaded ESM from CommonJS) ───
// Pi (@earendil-works/pi-coding-agent) ships as pure ESM. OKIT's backend is
// CommonJS, so we load it via dynamic import() and cache the exports.

let _piCache = null;
async function loadPi() {
  if (_piCache) return _piCache;
  _piCache = await import('@earendil-works/pi-coding-agent');
  return _piCache;
}

// ─── zod → typebox adapter ───
// Pi tools use typebox Type.Object for parameter schemas. OKIT's existing tools
// use zod. This converts the zod shapes we actually use into typebox.

let _typeboxCache = null;
async function loadTypebox() {
  if (_typeboxCache) return _typeboxCache;
  _typeboxCache = (await import('typebox')).Type;
  return _typeboxCache;
}

// Convert a zod schema node into a typebox schema node.
// Covers the types present in the OKIT agent tools:
// ZodObject / ZodString / ZodNumber / ZodEnum / ZodOptional / ZodRecord / ZodAny.
// Uses the public surface of zod v4 (node._def.type, node.isOptional(),
// node.options) instead of the removed v3 _def.typeName.
function zodToTypeboxNode(zodNode, Type) {
  const def = zodNode && zodNode._def;
  const type = def && def.type;
  const isOptional = typeof zodNode.isOptional === 'function' ? zodNode.isOptional() : false;

  let tb;
  switch (type) {
    case 'string':
      tb = Type.String();
      break;
    case 'number':
      tb = Type.Number();
      break;
    case 'boolean':
      tb = Type.Boolean();
      break;
    case 'enum': {
      const values = (Array.isArray(zodNode.options) ? zodNode.options : []).map(v => Type.Literal(v));
      tb = values.length ? Type.Union(values) : Type.String();
      break;
    }
    case 'optional':
      // Unwrap the inner type and re-wrap with Type.Optional.
      return Type.Optional(zodToTypeboxNode(def.innerType, Type));
    case 'record':
      tb = Type.Record(Type.String(), Type.Any());
      break;
    case 'any':
    default:
      // Fallback: accept any shape so the tool still registers.
      tb = Type.Any();
      break;
  }
  return isOptional ? Type.Optional(tb) : tb;
}

// Convert an OKIT tool's z.object(...) parameters into a typebox Type.Object.
async function zodToTypebox(zodSchema) {
  const Type = await loadTypebox();
  const shape = (zodSchema && zodSchema.shape) || {};
  const props = {};
  for (const [key, node] of Object.entries(shape)) {
    props[key] = zodToTypeboxNode(node, Type);
  }
  return Type.Object(props);
}

// ─── OKIT tool → Pi defineTool adapter ───
// Wraps the existing { description, parameters, execute } tool map as Pi
// customTools. The execute bodies (including the confirm_required flow) are
// left untouched — the adapter only translates the schema and return shape.

async function wrapToolsForPi(okitTools, piDefineTool) {
  const customTools = [];
  for (const [name, t] of Object.entries(okitTools)) {
    const parameters = await zodToTypebox(t.parameters);
    customTools.push(piDefineTool({
      name,
      label: name,
      description: t.description,
      parameters,
      execute: async (_toolCallId, params) => {
        let result;
        try {
          result = await t.execute(params || {});
        } catch (err) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            details: {},
          };
        }
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        return { content: [{ type: 'text', text }], details: {} };
      },
    }));
  }
  return customTools;
}

// ─── Pi ModelRuntime configuration (OpenAI-compatible providers) ───
// Builds a ModelRuntime, registers the configured provider (e.g. SiliconFlow)
// with its baseUrl + OpenAI-compatible api, injects the apiKey in memory, and
// returns the resolved Model for createAgentSession.

async function buildPiModelRuntime(pi, agentCfg, apiKey) {
  const { ModelRuntime } = pi;
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });

  // Register the provider if it isn't built-in. We treat it as OpenAI-compatible.
  const providerId = agentCfg.provider || 'siliconflow';
  if (!runtime.getRegisteredProviderIds().includes(providerId)) {
    runtime.registerProvider(providerId, {
      name: providerId,
      baseUrl: agentCfg.baseUrl,
      api: 'openai-completions',
      models: [
        {
          id: agentCfg.model,
          name: agentCfg.model,
          reasoning: false,
          input: ['text', 'image'],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 1 },
          contextWindow: 64000,
          maxTokens: 8192,
        },
      ],
    });
  }

  // Inject the apiKey in memory (no file written).
  await runtime.setRuntimeApiKey(providerId, apiKey);

  const model = runtime.getModel(providerId, agentCfg.model);
  return { runtime, model };
}

// ─── Helpers ───

function maskValue(val) {
  if (!val || val.length <= 8) return '****';
  return val.slice(0, 3) + '****' + val.slice(-3);
}

// ─── Skills ───

const SKILLS_DIR = path.join(os.homedir(), '.okit', 'skills');

function parseSkillFile(content, filename) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1];
  const body = match[2].trim();
  const meta = {};
  for (const line of frontmatter.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    } else {
      meta[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  if (!meta.name) return null;
  return { name: meta.name, description: meta.description || '', tools: meta.tools || null, instructions: body, file: filename };
}

function loadSkills() {
  const skills = [];
  try {
    if (!fs.existsSync(SKILLS_DIR)) return skills;
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
        const skill = parseSkillFile(content, file);
        if (skill) skills.push(skill);
      } catch {}
    }
  } catch {}
  return skills;
}

function buildSkillsPrompt() {
  const skills = loadSkills();
  if (skills.length === 0) return '';
  let prompt = '\n\n## 可用技能\n根据用户需求，自动选择并使用以下技能：\n';
  for (const s of skills) {
    prompt += `\n### ${s.name}\n${s.description}\n\n${s.instructions}\n`;
  }
  return prompt;
}

async function resolveAgentConfigFromProvider(agentCfg) {
  try {
    const providersPath = path.join(os.homedir(), '.okit', 'providers.json');
    if (!fs.existsSync(providersPath)) return agentCfg;
    const raw = fs.readFileSync(providersPath, 'utf-8');
    const data = JSON.parse(raw);
    const providers = Array.isArray(data?.providers) ? data.providers : [];
    const provider = providers.find(p => p.id === agentCfg.provider);
    if (!provider) return agentCfg;

    const endpoints = provider.endpoints || [{ type: provider.type, baseUrl: provider.baseUrl }];
    const endpoint = endpoints.find(ep => ep.type === 'openai') || endpoints[0] || {};
    const models = Array.isArray(provider.models) ? provider.models : [];
    const modelExists = models.some(m => m.id === agentCfg.model);

    return {
      ...agentCfg,
      baseUrl: endpoint.baseUrl || provider.baseUrl || agentCfg.baseUrl,
      apiKeyVaultKey: provider.vaultKey || agentCfg.apiKeyVaultKey,
      model: modelExists ? agentCfg.model : (models[0]?.id || agentCfg.model),
    };
  } catch {
    return agentCfg;
  }
}

async function resolveVaultValue(store, keyAlias) {
  if (!keyAlias) return null;
  return await store.get(keyAlias);
}

// ─── Agent Chat (SSE) ───

async function agentChat(req, res) {
  try {
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    const USER_CONFIG = path.join(os.homedir(), '.okit', 'user.json');
    let agentCfg = { provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V3', baseUrl: 'https://api.siliconflow.cn/v1', apiKeyVaultKey: 'SILICONFLOW_API_KEY' };
    try {
      const raw = fs.readFileSync(USER_CONFIG, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.agent) agentCfg = { ...agentCfg, ...parsed.agent };
    } catch {}
    agentCfg = await resolveAgentConfigFromProvider(agentCfg);

    const apiKey = await resolveVaultValue(store, agentCfg.apiKeyVaultKey);
    if (!apiKey) {
      return res.status(400).json({ error: `请先在密钥管理中添加 ${agentCfg.apiKeyVaultKey}` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messages = req.body.messages || [];
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    const sendEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    sendEvent('session', { sessionId });

    const CONFIG_PATH = path.join(os.homedir(), '.okit', 'user.json');
    const HISTORY_FILE = path.join(os.homedir(), '.okit', 'logs', 'history.jsonl');
    const platform = os.platform();

    const tools = {
      // ─── 应用管理 ───
      open_app: {
        description: '打开应用程序',
        parameters: z.object({
          name: z.string().describe('应用名称'),
        }),
        execute: async ({ name }) => {
          try {
            if (platform === 'darwin') {
              await execa('open', ['-a', name], { timeout: 10000 });
            } else {
              await execa(name, [], { timeout: 10000, detached: true });
            }
            return JSON.stringify({ success: true, message: `已打开 ${name}` });
          } catch (err) {
            return JSON.stringify({ success: false, error: err.message });
          }
        },
      },

      // ─── 密钥管理 ───
      list_vault_keys: {
        description: '列出所有已存储的密钥',
        parameters: z.object({}),
        execute: async () => {
          const { VaultStore } = require('../../vault/store');
          const store = new VaultStore();
          const list = await store.list();
          return JSON.stringify(list.map(k => ({
            key: k.key,
            desc: k.desc,
            group: k.group,
            hasValue: !!k.hasValue,
          })));
        },
      },
      get_vault_value: {
        description: '获取指定密钥的值（脱敏显示）',
        parameters: z.object({
          key: z.string().describe('密钥名称'),
        }),
        execute: async ({ key }) => {
          const { VaultStore } = require('../../vault/store');
          const store = new VaultStore();
          const val = await store.get(key);
          if (!val) return JSON.stringify({ exists: false });
          return JSON.stringify({ exists: true, value: maskValue(val), length: val.length });
        },
      },
      set_vault_key: {
        description: '添加或更新密钥（需要用户确认）',
        parameters: z.object({
          key: z.string().describe('密钥名称'),
          value: z.string().describe('密钥值'),
          group: z.string().optional().describe('分组'),
        }),
        execute: async ({ key, value, group }) => {
          sendEvent('confirm_required', { sessionId, action: '设置密钥', target: key, reason: `即将设置密钥 ${key}` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          const { VaultStore } = require('../../vault/store');
          const store = new VaultStore();
          await store.set(key, value, group);
          require('./sync-scheduler').markDirty('secrets');
          return JSON.stringify({ success: true, key });
        },
      },
      delete_vault_key: {
        description: '删除密钥（需要用户确认）',
        parameters: z.object({
          key: z.string().describe('密钥名称'),
        }),
        execute: async ({ key }) => {
          sendEvent('confirm_required', { sessionId, action: '删除密钥', target: key, reason: `即将删除密钥 ${key}` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          const { VaultStore } = require('../../vault/store');
          const store = new VaultStore();
          await store.delete(key);
          require('./sync-scheduler').markDirty('secrets');
          return JSON.stringify({ success: true, key });
        },
      },

      // ─── API Key 自动创建 ───
      create_api_key: {
        description: '自动创建指定平台的 API Key（需要 Chrome 扩展连接，需用户确认）。支持平台：cloudflare / volcengine / zhipu / minimax',
        parameters: z.object({
          platform: z.string().describe('平台ID：cloudflare / volcengine / zhipu / minimax'),
          tokenName: z.string().describe('新密钥的名称'),
          vaultKey: z.string().optional().describe('存入 Vault 时使用的密钥名（不填则用平台默认名）'),
        }),
        execute: async ({ platform, tokenName, vaultKey }) => {
          const { autoCreateKey } = require('./auto-create');
          const { isExtensionConnected } = require('./ws-extension');
          const SUPPORTED = ['cloudflare', 'volcengine', 'zhipu', 'minimax'];
          if (!SUPPORTED.includes(platform)) {
            return JSON.stringify({ success: false, error: `不支持的平台 ${platform}，支持：${SUPPORTED.join(', ')}` });
          }
          if (!isExtensionConnected()) {
            return JSON.stringify({ success: false, error: 'Chrome 扩展未连接，无法自动创建。请先安装并连接 OKIT Chrome 扩展。' });
          }
          sendEvent('confirm_required', { sessionId, action: '创建 API Key', target: `${platform}/${tokenName}`, reason: `即将通过 Chrome 扩展在 ${platform} 平台创建 API Key「${tokenName}」` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });

          // Simulate req/res to reuse the existing Express handler
          const fakeRes = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; } };
          try {
            await autoCreateKey({ body: { platform, tokenName } }, fakeRes);
          } catch (err) {
            return JSON.stringify({ success: false, error: err.message || String(err) });
          }
          if (fakeRes.statusCode !== 200 || !fakeRes.body?.success) {
            const body = fakeRes.body || {};
            if (body.loginRequired) {
              return JSON.stringify({ success: false, error: `${platform} 平台需要先登录，请在 Chrome 扩展控制的浏览器中完成登录后重试`, loginRequired: true });
            }
            return JSON.stringify({ success: false, error: body.error || body.message || `创建失败 (HTTP ${fakeRes.statusCode})` });
          }

          // Auto-store the created key into Vault
          const createdValue = fakeRes.body.value;
          const storeKey = vaultKey || `${platform.toUpperCase()}_${tokenName.toUpperCase().replace(/\s+/g, '_')}`;
          try {
            const { VaultStore } = require('../../vault/store');
            const store = new VaultStore();
            await store.set(storeKey, createdValue, platform);
            require('./sync-scheduler').markDirty('secrets');
            return JSON.stringify({ success: true, platform, vaultKey: storeKey, name: fakeRes.body.name, message: `已创建并保存到 Vault（密钥名：${storeKey}）` });
          } catch (err) {
            // Key created but failed to save — return value so user can save manually
            return JSON.stringify({ success: true, platform, name: fakeRes.body.name, value: createdValue, warning: `创建成功但保存到 Vault 失败：${err.message}。请手动保存此密钥值。` });
          }
        },
      },

      // ─── 密钥绑定到项目 ───
      bind_key_to_project: {
        description: '将密钥绑定到指定项目（写入项目的 .okitenv 文件，需用户确认）',
        parameters: z.object({
          projectPath: z.string().describe('项目根目录的绝对路径'),
          keys: z.array(z.object({
            key: z.string().describe('Vault 中的密钥名'),
          })).min(1).describe('要绑定的密钥列表'),
        }),
        execute: async ({ projectPath, keys }) => {
          sendEvent('confirm_required', { sessionId, action: '绑定密钥到项目', target: projectPath, reason: `即将把 ${keys.length} 个密钥写入 ${projectPath}/.okitenv` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          const { syncVaultToProject } = require('./vault');
          const fakeRes = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; } };
          try {
            await syncVaultToProject({ body: { keys, projectPath } }, fakeRes);
          } catch (err) {
            return JSON.stringify({ success: false, error: err.message || String(err) });
          }
          return JSON.stringify(fakeRes.body || { success: false, error: '未知错误' });
        },
      },

      // ─── 云同步 ───
      sync_push: {
        description: '推送本地 Vault 密钥到云端同步平台（需用户确认。前提：已设置同步密码并启用同步平台）',
        parameters: z.object({}),
        execute: async () => {
          sendEvent('confirm_required', { sessionId, action: '推送密钥到云端', target: 'sync-push', reason: '即将把本地所有密钥加密推送到云端同步平台' });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          const core = require('./cloud-sync-core');
          try {
            const result = await core.syncPush();
            return JSON.stringify({ success: true, ...result });
          } catch (err) {
            return JSON.stringify({ success: false, error: err.message || String(err) });
          }
        },
      },
      sync_pull: {
        description: '从云端同步平台拉取密钥到本地（需用户确认。前提：已设置同步密码并启用同步平台）',
        parameters: z.object({}),
        execute: async () => {
          sendEvent('confirm_required', { sessionId, action: '从云端拉取密钥', target: 'sync-pull', reason: '即将从云端同步平台拉取密钥并合并到本地' });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          const core = require('./cloud-sync-core');
          try {
            const result = await core.syncPull();
            return JSON.stringify({ success: true, ...result });
          } catch (err) {
            const msg = err.message || String(err);
            if (/Unsupported state|AUTHENTICATION_FAILED/i.test(msg)) {
              return JSON.stringify({ success: false, error: '同步密码不正确，无法解密远端数据' });
            }
            return JSON.stringify({ success: false, error: msg });
          }
        },
      },

      // ─── 日志 ───
      get_logs: {
        description: '获取最近的操作日志',
        parameters: z.object({
          limit: z.number().optional().describe('返回条数，默认 20'),
        }),
        execute: async ({ limit }) => {
          const n = limit || 20;
          try {
            if (!fs.existsSync(HISTORY_FILE)) return JSON.stringify([]);
            const content = fs.readFileSync(HISTORY_FILE, 'utf8');
            const lines = content.trim().split('\n').filter(Boolean);
            const logs = lines.slice(-n).map(line => {
              try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean).map(redactLog);
            return JSON.stringify(logs.map(l => ({
              time: l.timestamp,
              action: l.action,
              target: l.target,
              success: l.success,
              output: (l.output || '').substring(0, 100),
            })));
          } catch {
            return JSON.stringify([]);
          }
        },
      },

      // ─── 设置 ───
      get_settings: {
        description: '获取 OKIT 配置',
        parameters: z.object({}),
        execute: async () => {
          try {
            if (!(await fse.pathExists(CONFIG_PATH))) return JSON.stringify({});
            const config = await fse.readJson(CONFIG_PATH);
            return JSON.stringify(config);
          } catch {
            return JSON.stringify({});
          }
        },
      },
      update_settings: {
        description: '更新 OKIT 配置（需要用户确认）',
        parameters: z.object({
          settings: z.record(z.any()).describe('要更新的配置项'),
        }),
        execute: async ({ settings }) => {
          sendEvent('confirm_required', { sessionId, action: '更新配置', target: 'OKIT Settings', reason: `即将更新配置: ${Object.keys(settings).join(', ')}` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          try {
            let config = {};
            if (await fse.pathExists(CONFIG_PATH)) config = await fse.readJson(CONFIG_PATH);
            Object.assign(config, settings);
            await fse.writeJson(CONFIG_PATH, config, { spaces: 2 });
            return JSON.stringify({ success: true });
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },
    };

    const systemPrompt = `你是 OKIT 智能助手，一个全能的 AI Agent，可以帮助用户管理密钥、Provider、模型和配置。

你可以使用以下功能：
- 应用管理：open_app（打开应用程序）
- 密钥管理：list_vault_keys（列出密钥）、get_vault_value（查看值）、set_vault_key（设置）、delete_vault_key（删除）
- API Key 自动创建：create_api_key（支持 cloudflare/volcengine/zhipu/minimax，需 Chrome 扩展连接。创建后自动存入 Vault）
- 密钥绑定项目：bind_key_to_project（将密钥写入项目 .okitenv 文件，实现项目级密钥注入）
- 云同步：sync_push（推送到云端）、sync_pull（从云端拉取）
- 日志：get_logs（操作历史）
- 设置：get_settings（查看配置）、update_settings（更新配置）

当用户要求创建 API Key 时，优先使用 create_api_key 工具自动创建（支持智谱、火山引擎、Cloudflare、MiniMax）。如果 Chrome 扩展未连接，再告知用户需要先安装扩展。

工作流程：
1. 理解用户意图，判断需要执行哪些操作
2. 先用查询类工具获取当前状态
3. 然后执行操作，所有破坏性操作（安装/卸载/删除/修改/创建/同步）需要等待用户确认
4. 汇报操作结果

注意事项：
- 安装/升级/卸载/删除/修改/创建/同步 操作都需要等待用户确认后才能执行
- 密钥值在展示时已自动脱敏
- 用中文回复
- 回复简洁明了，使用 markdown 格式
- 不要捏造不存在的应用名称${buildSkillsPrompt()}`;

    try {
      // ─── Pi Agent Kernel ───
      // Replace the previous streamText loop with a Pi AgentSession. The OKIT
      // tools object is wrapped as Pi customTools. We pass an explicit `tools`
      // allowlist naming only the OKIT tools — this both enables them and keeps
      // Pi's built-in coding tools (read/bash/edit/write) out, so the agent can
      // only act through OKIT's capabilities.
      const pi = await loadPi();
      const customTools = await wrapToolsForPi(tools, pi.defineTool);
      const toolNames = customTools.map(t => t.name);
      const { runtime: piRuntime, model: piModel } = await buildPiModelRuntime(pi, agentCfg, apiKey);

      const { session } = await pi.createAgentSession({
        model: piModel,
        modelRuntime: piRuntime,
        customTools,
        tools: toolNames,
      });

      // Seed the conversation history so multi-turn context survives a page
      // reload — Pi sessions start empty, so we replay prior user/assistant
      // turns as a folded transcript summary.
      const priorTurns = messages.slice(0, -1).filter(m => m.role === 'user' || m.role === 'assistant');
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      const historyPreamble = priorTurns.length
        ? priorTurns.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n') + '\n\n(以上是历史对话，请基于此上下文继续。)\n\n'
        : '';

      // Map Pi events onto the existing SSE contract the frontend expects:
      //   message_update + text_delta -> 'text'
      //   tool_execution_start       -> 'tool_call'
      //   tool_execution_end         -> 'tool_result'
      //   agent_end                  -> 'done'
      // (confirm_required is emitted directly inside each tool's execute body.)
      const unsubscribe = session.subscribe((event) => {
        switch (event.type) {
          case 'message_update': {
            const sub = event.assistantMessageEvent;
            if (sub && sub.type === 'text_delta' && typeof sub.delta === 'string') {
              sendEvent('text', { content: sub.delta });
            }
            break;
          }
          case 'tool_execution_start':
            sendEvent('tool_call', { tool: event.toolName, args: event.args });
            break;
          case 'tool_execution_end': {
            // Pi wraps results as { content: [{type:'text', text}], details }.
            // Unwrap back to the original OKIT tool return value so the frontend
            // receives the same shape it did under the old streamText kernel.
            const raw = event.result;
            let payload = raw;
            const textPart = raw && Array.isArray(raw.content) && raw.content[0] && raw.content[0].text;
            if (typeof textPart === 'string') {
              try { payload = JSON.parse(textPart); } catch { payload = textPart; }
            }
            sendEvent('tool_result', { tool: event.toolName, result: payload });
            break;
          }
          case 'agent_end':
            sendEvent('done', null);
            break;
        }
      });

      try {
        // Extract images from the last user message (if any) and convert to
        // Pi's ImageContent shape { type:'image', data, mimeType }.
        const rawImages = Array.isArray(lastUserMsg?.images) ? lastUserMsg.images : [];
        const piImages = rawImages
          .filter(img => img && typeof img.data === 'string' && typeof img.mimeType === 'string')
          .map(img => ({ type: 'image', data: img.data, mimeType: img.mimeType }));

        // Guard against Pi hanging (e.g. missing/invalid apiKey leaves the
        // model stream pending forever). Race the prompt against a timeout so
        // the frontend always receives a terminal event and can recover.
        //
        // The timeout is "soft" — it resets whenever a tool is awaiting user
        // confirmation, so the user has unlimited time to confirm/reject.
        const promptText = historyPreamble + (lastUserMsg?.content || '');
        const promptPromise = piImages.length > 0
          ? session.prompt(promptText, { images: piImages })
          : session.prompt(promptText);
        const timeoutPromise = new Promise((_, reject) => {
          const baseTimeout = 60000;
          let elapsed = 0;
          const tick = () => {
            // If a confirmation is pending, don't count toward timeout.
            const sessionEntry = agentSessions.get(sessionId);
            if (sessionEntry && sessionEntry.confirmResolve) {
              elapsed = 0; // reset — user is deciding
            } else {
              elapsed += 5000;
            }
            if (elapsed >= baseTimeout) {
              reject(new Error('Agent 响应超时(60s),请检查模型配置和 API Key'));
            } else {
              setTimeout(tick, 5000);
            }
          };
          setTimeout(tick, 5000);
        });
        await Promise.race([promptPromise, timeoutPromise]);
      } catch (promptErr) {
        sendEvent('error', { message: promptErr.message || 'Agent 执行失败' });
        sendEvent('done', null);
      } finally {
        unsubscribe();
        session.dispose();
      }
    } catch (err) {
      sendEvent('error', { message: err.message });
    }

    res.end();
  } catch (error) {
    console.error('Agent chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Agent 启动失败' });
    }
  }
}

// ─── Confirm ───

async function agentConfirm(req, res) {
  const { sessionId, approved } = req.body;
  const session = agentSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
  session.confirmResolve(approved ? true : false);
  agentSessions.delete(sessionId);
  res.json({ ok: true });
}

// ─── Conversation Persistence ───

const AGENT_DIR = path.join(os.homedir(), '.okit', 'agent');
const MSGS_DIR = path.join(AGENT_DIR, 'messages');
const CONV_FILE = path.join(AGENT_DIR, 'conversations.json');

function ensureAgentDir() {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(MSGS_DIR, { recursive: true });
}

function readConvIndex() {
  ensureAgentDir();
  try { return JSON.parse(fs.readFileSync(CONV_FILE, 'utf-8')); }
  catch { return []; }
}

function writeConvIndex(list) {
  ensureAgentDir();
  fs.writeFileSync(CONV_FILE, JSON.stringify(list, null, 2));
}

function listConversations(req, res) {
  res.json(readConvIndex());
}

function getConversation(req, res) {
  const file = path.join(MSGS_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
}

function createConversation(req, res) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const conv = { id, title: '新对话', createdAt: Date.now(), updatedAt: Date.now() };
  const list = readConvIndex();
  list.unshift(conv);
  writeConvIndex(list);
  fs.writeFileSync(path.join(MSGS_DIR, id + '.json'), '[]');
  res.json(conv);
}

function updateConversation(req, res) {
  const { messages, title } = req.body;
  const id = req.params.id;
  if (messages) {
    fs.writeFileSync(path.join(MSGS_DIR, id + '.json'), JSON.stringify(messages));
  }
  const list = readConvIndex();
  const conv = list.find(c => c.id === id);
  if (conv) {
    if (title) conv.title = title;
    conv.updatedAt = Date.now();
    writeConvIndex(list);
  }
  res.json({ ok: true });
}

function deleteConversation(req, res) {
  const id = req.params.id;
  const list = readConvIndex().filter(c => c.id !== id);
  writeConvIndex(list);
  const file = path.join(MSGS_DIR, id + '.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
}

module.exports = { agentChat, agentConfirm, listConversations, getConversation, createConversation, updateConversation, deleteConversation };
