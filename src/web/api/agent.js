const os = require('os');
const fs = require('fs');
const path = require('path');
const execa = require('execa');
const fse = require('fs-extra');
const { createOpenAI } = require('@ai-sdk/openai');
const { streamText, stepCountIs } = require('ai');
const { z } = require('zod');

const agentSessions = new Map();

// ─── Helpers ───

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

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
  let value = await store.get(keyAlias);
  if (value) return value;
  const { VaultStore } = require('../../vault/store');
  const parsed = VaultStore.parseKeyAlias(keyAlias);
  return await store.resolve(parsed.key, parsed.alias);
}

async function listToolsImpl(filter) {
  const toolsApi = require('./tools');
  const { loadRegistry, resolveCmd } = require('../../config/registry');

  const registry = await loadRegistry();
  const steps = registry.steps || [];

  // Try to use cached tool data from disk cache
  const CACHE_FILE = path.join(os.homedir(), '.okit', 'cache', 'tools.json');
  let cached = null;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.tools && Date.now() - (data._cacheTime || 0) < 30 * 60 * 1000) {
        cached = data.tools;
      }
    }
  } catch {}

  if (!cached) {
    // Quick check — just return registry info without full status check
    return JSON.stringify(steps.map(s => ({
      name: s.name,
      category: s.category || 'other',
      description: s.description || s.detail || '',
      install: resolveCmd(s.install) || null,
      homepage: s.homepage || null,
    })));
  }

  let filtered = cached;
  if (filter === 'installed') filtered = cached.filter(t => t.installed);
  else if (filter === 'not_installed') filtered = cached.filter(t => !t.installed);
  else if (filter === 'unauthorized') filtered = cached.filter(t => t.authStatus === 'unauthorized');

  return JSON.stringify(filtered.map(t => ({
    name: t.name,
    category: t.category,
    installed: t.installed,
    version: t.version,
    authStatus: t.authStatus,
    description: t.description || t.detail || '',
    hasUpgrade: t.hasUpgrade,
  })));
}

// ─── Tool: Execute Tool Action ───

async function executeToolAction(toolName, action) {
  const { loadRegistry, resolveCmd } = require('../../config/registry');
  const registry = await loadRegistry();
  const step = registry.steps?.find(s => s.name === toolName);
  if (!step) return JSON.stringify({ error: `未找到工具: ${toolName}` });

  const cmdField = step[action];
  const cmd = resolveCmd(cmdField);
  if (!cmd) return JSON.stringify({ error: `${toolName} 不支持 ${action} 操作` });

  try {
    const { stdout, stderr } = await execa.command(cmd, { shell: true, timeout: 300000, reject: false });
    const output = (stdout || '') + (stderr || '');
    return JSON.stringify({ success: true, output: output.substring(0, 1000) });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
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

    const aiProvider = createOpenAI({
      baseURL: agentCfg.baseUrl,
      apiKey,
    });

    const CONFIG_PATH = path.join(os.homedir(), '.okit', 'user.json');
    const HISTORY_FILE = path.join(os.homedir(), '.okit', 'logs', 'history.jsonl');
    const platform = os.platform();

    const tools = {
      // ─── 工具管理 ───
      list_tools: {
        description: '列出所有开发工具及其安装/授权状态',
        parameters: z.object({
          filter: z.enum(['all', 'installed', 'not_installed', 'unauthorized']).optional().describe('筛选条件'),
        }),
        execute: async ({ filter }) => {
          return await listToolsImpl(filter || 'all');
        },
      },
      install_tool: {
        description: '安装指定工具（需要用户确认）',
        parameters: z.object({
          name: z.string().describe('工具名称'),
        }),
        execute: async ({ name }) => {
          sendEvent('confirm_required', { sessionId, action: '安装', target: name, reason: `即将安装 ${name}` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true, reason: '用户拒绝' });
          return await executeToolAction(name, 'install');
        },
      },
      upgrade_tool: {
        description: '升级指定工具（需要用户确认）',
        parameters: z.object({
          name: z.string().describe('工具名称'),
        }),
        execute: async ({ name }) => {
          sendEvent('confirm_required', { sessionId, action: '升级', target: name, reason: `即将升级 ${name}` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          return await executeToolAction(name, 'upgrade');
        },
      },
      uninstall_tool: {
        description: '卸载指定工具（需要用户确认）',
        parameters: z.object({
          name: z.string().describe('工具名称'),
        }),
        execute: async ({ name }) => {
          sendEvent('confirm_required', { sessionId, action: '卸载', target: name, reason: `即将卸载 ${name}` });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) return JSON.stringify({ cancelled: true });
          return await executeToolAction(name, 'uninstall');
        },
      },
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
            alias: k.alias,
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
          return JSON.stringify({ success: true, key });
        },
      },

      // ─── 系统监控 ───
      get_system_info: {
        description: '获取系统信息：CPU、内存、磁盘、GPU',
        parameters: z.object({}),
        execute: async () => {
          const cpus = os.cpus();
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          let diskLine = '';
          try {
            const { stdout } = await execa.command('df -h /', { timeout: 5000, reject: false });
            diskLine = stdout.split('\n')[1] || '';
          } catch {}

          return JSON.stringify({
            cpu: { model: cpus[0]?.model || 'Unknown', cores: cpus.length, loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100) },
            memory: { total: formatBytes(totalMem), used: formatBytes(totalMem - freeMem), free: formatBytes(freeMem), usagePercent: Math.round((1 - freeMem / totalMem) * 1000) / 10 + '%' },
            disk: diskLine,
            uptime: Math.floor(os.uptime() / 3600) + '小时',
            platform: os.platform(),
            hostname: os.hostname(),
          });
        },
      },
      get_disk_usage: {
        description: '获取指定目录的磁盘占用',
        parameters: z.object({
          path: z.string().describe('目录路径'),
        }),
        execute: async ({ path: dirPath }) => {
          const resolved = dirPath.replace(/^~/, os.homedir());
          if (!fs.existsSync(resolved)) return JSON.stringify({ error: '目录不存在' });
          try {
            const entries = fs.readdirSync(resolved, { withFileTypes: true });
            const items = [];
            const batchSize = 10;
            for (let i = 0; i < entries.length && i < 50; i += batchSize) {
              const batch = entries.slice(i, i + batchSize);
              const results = await Promise.allSettled(
                batch.filter(e => e.isDirectory()).map(async entry => {
                  const fullPath = path.join(resolved, entry.name);
                  try {
                    const { stdout } = await execa('du', ['-sh', fullPath], { timeout: 15000, reject: false });
                    const m = stdout?.match(/^(\S+)\s/);
                    if (m) return { name: entry.name, size: m[1] };
                  } catch {}
                  return null;
                })
              );
              for (const r of results) {
                if (r.status === 'fulfilled' && r.value) items.push(r.value);
              }
            }
            return JSON.stringify(items);
          } catch (err) {
            return JSON.stringify({ error: err.message });
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
            }).filter(Boolean);
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

    const systemPrompt = `你是 OKIT 智能助手，一个全能的 AI Agent，可以帮助用户管理开发工具、密钥和系统资源。

你可以使用以下功能：
- 工具管理：list_tools（查看工具列表）、install_tool（安装）、upgrade_tool（升级）、uninstall_tool（卸载）、open_app（打开应用）
- 密钥管理：list_vault_keys（列出密钥）、get_vault_value（查看值）、set_vault_key（设置）、delete_vault_key（删除）
- 系统监控：get_system_info（CPU/内存/磁盘）、get_disk_usage（目录占用）
- 日志：get_logs（操作历史）
- 设置：get_settings（查看配置）、update_settings（更新配置）

工作流程：
1. 理解用户意图，判断需要执行哪些操作
2. 先用查询类工具获取当前状态
3. 然后执行操作，所有破坏性操作（安装/卸载/删除/修改）需要等待用户确认
4. 汇报操作结果

注意事项：
- 安装/升级/卸载/删除/修改 操作都需要等待用户确认后才能执行
- 密钥值在展示时已自动脱敏
- 用中文回复
- 回复简洁明了，使用 markdown 格式
- 不要捏造不存在的工具，先 list_tools 查看有哪些${buildSkillsPrompt()}`;

    try {
      const result = streamText({
        model: aiProvider.chat(agentCfg.model),
        system: systemPrompt,
        messages,
        tools,
        maxSteps: 20,
        stopWhen: stepCountIs(20),
      });

      for await (const event of result.fullStream) {
        switch (event.type) {
          case 'text-delta':
            sendEvent('text', { content: event.text });
            break;
          case 'tool-call':
            sendEvent('tool_call', { tool: event.toolName, args: event.input });
            break;
          case 'tool-result':
            sendEvent('tool_result', { tool: event.toolName, result: event.output });
            break;
          case 'finish-step':
            break;
          case 'finish':
            sendEvent('done', null);
            break;
        }
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
