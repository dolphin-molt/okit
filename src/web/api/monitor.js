const os = require('os');
const fs = require('fs');
const path = require('path');
const execa = require('execa');
const { createOpenAI } = require('@ai-sdk/openai');
const { streamText, stepCountIs } = require('ai');
const { z } = require('zod');

const platform = os.platform();

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

let gpuCache = null;
let gpuCacheTime = 0;
const GPU_CACHE_TTL = 30000;

async function getMonitor(req, res) {
  try {
    const now = Date.now();
    if (cache && now - cacheTime < CACHE_TTL) {
      return res.json(cache);
    }

    const platform = os.platform();
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const [cpuUsage, diskData, swapData, gpuData] = await Promise.all([
      getCpuUsage(platform),
      getDiskInfo(),
      getSwapInfo(platform),
      getGpuInfo(platform),
    ]);

    const result = {
      cpu: {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        usage: cpuUsage,
        loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100),
      },
      memory: {
        total: totalMem,
        used: usedMem,
        usagePercent: Math.round((usedMem / totalMem) * 1000) / 10,
      },
      swap: swapData,
      disk: diskData,
      gpu: gpuData,
      uptime: os.uptime(),
      hostname: os.hostname(),
    };

    cache = result;
    cacheTime = now;
    res.json(result);
  } catch (error) {
    console.error('Monitor error:', error);
    res.status(500).json({ error: 'Failed to get system info' });
  }
}

async function getCpuUsage(platform) {
  try {
    if (platform === 'darwin') {
      const { stdout } = await execa.command('top -l 1 -n 0 -s 0', { timeout: 8000 });
      const match = stdout.match(/(\d+\.\d+)%\s*idle/);
      if (match) return Math.round((100 - parseFloat(match[1])) * 10) / 10;
    } else if (platform === 'linux') {
      const { stdout } = await execa.command('top -bn1', { timeout: 8000 });
      const match = stdout.match(/(\d+\.\d+)\s*id/);
      if (match) return Math.round((100 - parseFloat(match[1])) * 10) / 10;
    }
  } catch {}
  return null;
}

async function getDiskInfo() {
  try {
    const { stdout } = await execa.command('df -h', { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(1);
    return lines.map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 6) return null;
      // macOS has extra columns (iused, ifree, %iused) before mount
      // Format: filesystem size used avail capacity [iused ifree %iused] mount
      const hasExtra = parts.length > 6;
      return {
        filesystem: parts[0],
        size: parts[1],
        used: parts[2],
        available: parts[3],
        capacity: parts[4],
        mount: hasExtra ? parts[parts.length - 1] : parts[5],
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function getSwapInfo(platform) {
  try {
    if (platform === 'darwin') {
      const { stdout } = await execa.command('sysctl vm.swapusage', { timeout: 3000 });
      const total = stdout.match(/total = (\S+)/)?.[1] || '0';
      const used = stdout.match(/used = (\S+)/)?.[1] || '0';
      return { total, used };
    } else if (platform === 'linux') {
      const { stdout } = await execa.command('cat /proc/meminfo | grep SwapTotal SwapFree', { timeout: 3000 });
      const totalMatch = stdout.match(/SwapTotal:\s+(\d+)\s+kB/);
      const freeMatch = stdout.match(/SwapFree:\s+(\d+)\s+kB/);
      if (totalMatch && freeMatch) {
        const total = parseInt(totalMatch[1]) * 1024;
        const free = parseInt(freeMatch[1]) * 1024;
        return {
          total: formatBytes(total),
          used: formatBytes(total - free),
        };
      }
    }
  } catch {}
  return null;
}

async function getGpuInfo(platform) {
  try {
    const now = Date.now();
    if (gpuCache && now - gpuCacheTime < GPU_CACHE_TTL) {
      return gpuCache;
    }
    if (platform === 'darwin') {
      const { stdout } = await execa.command('system_profiler SPDisplaysDataType', { timeout: 15000 });
      const model = stdout.match(/Chipset Model:\s*(.+)/)?.[1]?.trim()
        || stdout.match(/Model:\s*(.+)/)?.[1]?.trim();
      const vram = stdout.match(/VRAM \(Total\):\s*(.+)/)?.[1]?.trim()
        || stdout.match(/VRAM:\s*(.+)/)?.[1]?.trim()
        || 'Shared Memory';
      const result = model ? { model, vram } : null;
      gpuCache = result;
      gpuCacheTime = now;
      return result;
    }
  } catch {}
  return null;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

async function getDu(req, res) {
  try {
    const rawPath = req.query.path || os.homedir();
    const resolvedPath = rawPath.replace(/^~/, os.homedir());
    const platform = os.platform();
    const args = platform === 'darwin'
      ? ['-d', '1', '-h', resolvedPath]
      : ['--max-depth=1', '-h', resolvedPath];

    let stdout = '';
    try {
      const result = await execa('du', args, { timeout: 60000, reject: false });
      stdout = result.stdout || '';
    } catch {
      // du may partially fail on permission errors
    }

    if (!stdout.trim()) {
      // Fallback: list immediate children and du each one
      try {
        const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const items = [];
        const batchSize = 10;
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(async entry => {
              const fullPath = path.join(resolvedPath, entry.name);
              try {
                const r = await execa('du', ['-sh', fullPath], { timeout: 15000, reject: false });
                const m = r.stdout?.match(/^(\S+)\s+(.*)/);
                if (m) return { name: entry.name, fullPath, size: m[1], bytes: parseSizeToBytes(m[1]) };
              } catch {}
              return null;
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) items.push(r.value);
          }
        }
        items.sort((a, b) => b.bytes - a.bytes);
        return res.json({ path: resolvedPath, items });
      } catch {
        return res.json({ path: resolvedPath, items: [] });
      }
    }
    const lines = stdout.trim().split('\n');

    const items = [];
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(.*)/);
      if (!match) continue;
      const sizeStr = match[1];
      const name = match[2];
      if (name === resolvedPath) continue;
      const bytes = parseSizeToBytes(sizeStr);
      items.push({ name: path.basename(name), fullPath: name, size: sizeStr, bytes });
    }

    items.sort((a, b) => b.bytes - a.bytes);
    res.json({ path: resolvedPath, items });
  } catch (error) {
    console.error('du error:', error);
    res.status(500).json({ error: 'Failed to scan directory' });
  }
}

function parseSizeToBytes(sizeStr) {
  const match = sizeStr.match(/^([\d.]+)\s*([BKMGT])/i);
  if (!match) return parseFloat(sizeStr) || 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 };
  return num * (multipliers[unit] || 1);
}

// ─── Cleanup Scanner ───

async function getDirSize(dirPath) {
  try {
    const { stdout } = await execa('du', ['-sh', dirPath], { timeout: 15000, reject: false });
    const m = stdout?.match(/^(\S+)\s/);
    return m ? { size: m[1], bytes: parseSizeToBytes(m[1]) } : null;
  } catch {
    return null;
  }
}

async function getCleanupScan(req, res) {
  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const home = os.homedir();
    const items = [];

    // 1. Send disk info immediately
    let diskInfo = null;
    try {
      const { stdout } = await execa.command('df -h /', { timeout: 5000, reject: false });
      const lines = (stdout || '').trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const totalBytes = parseSizeToBytes(parts[1]);
        const availBytes = parseSizeToBytes(parts[3]);
        const actualUsedBytes = totalBytes - availBytes;
        diskInfo = {
          total: parts[1],
          used: parts[2],
          available: parts[3],
          capacity: parts[4],
          actualUsed: formatBytes(actualUsedBytes),
        };
      }
    } catch {}
    send('diskInfo', diskInfo);

    // 2. Build check list
    const checks = [
      { name: 'npm 缓存', path: path.join(home, '.npm', '_cacache'), safe: true, category: 'cache', desc: 'npm 包下载缓存，清理后按需重建' },
      { name: 'yarn 缓存', path: path.join(home, '.cache', 'yarn'), safe: true, category: 'cache', desc: 'Yarn 包下载缓存' },
      { name: 'pnpm 缓存', path: path.join(home, '.pnpm-store'), safe: true, category: 'cache', desc: 'pnpm 内容寻址存储' },
      { name: 'pip 缓存', path: path.join(home, 'Library', 'Caches', 'pip'), safe: true, category: 'cache', desc: 'pip 包下载缓存' },
      { name: 'Homebrew 缓存', path: path.join(home, 'Library', 'Caches', 'Homebrew'), safe: true, category: 'cache', desc: 'Homebrew 下载缓存' },
      { name: 'Maven 缓存', path: path.join(home, '.m2', 'repository'), safe: true, category: 'cache', desc: 'Maven 依赖本地仓库' },
      { name: 'Gradle 缓存', path: path.join(home, '.gradle', 'caches'), safe: true, category: 'cache', desc: 'Gradle 构建缓存' },
      { name: 'Cargo 缓存', path: path.join(home, '.cargo', 'registry'), safe: true, category: 'cache', desc: 'Rust Cargo 包缓存' },
      { name: 'Xcode DerivedData', path: path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'), safe: true, category: 'dev', desc: 'Xcode 编译中间文件' },
      { name: 'Xcode Archives', path: path.join(home, 'Library', 'Developer', 'Xcode', 'Archives'), safe: true, category: 'dev', desc: 'Xcode 打包归档' },
      { name: 'Xcode iOS DeviceSupport', path: path.join(home, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'), safe: true, category: 'dev', desc: 'iOS 设备调试支持文件' },
      { name: 'CocoaPods 缓存', path: path.join(home, 'Library', 'Caches', 'CocoaPods'), safe: true, category: 'cache', desc: 'CocoaPods 仓库缓存' },
      { name: 'Swift PM 缓存', path: path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'), safe: true, category: 'cache', desc: 'Swift Package Manager 缓存' },
      { name: '用户日志', path: path.join(home, 'Library', 'Logs'), safe: true, category: 'log', desc: '应用日志文件' },
      { name: '废纸篓', path: path.join(home, '.Trash'), safe: true, category: 'trash', desc: '已删除但未清空的文件' },
      { name: '下载文件夹', path: path.join(home, 'Downloads'), safe: false, category: 'download', desc: '用户下载文件，需评估' },
      { name: 'Chrome 缓存', path: path.join(home, 'Library', 'Caches', 'Google', 'Chrome'), safe: true, category: 'browser', desc: 'Chrome 浏览器缓存' },
      { name: 'Firefox 缓存', path: path.join(home, 'Library', 'Caches', 'Firefox'), safe: true, category: 'browser', desc: 'Firefox 浏览器缓存' },
      { name: 'Edge 缓存', path: path.join(home, 'Library', 'Caches', 'Microsoft Edge'), safe: true, category: 'browser', desc: 'Edge 浏览器缓存' },
      { name: 'Safari 缓存', path: path.join(home, 'Library', 'Caches', 'com.apple.Safari'), safe: true, category: 'browser', desc: 'Safari 浏览器缓存' },
      { name: 'Xcode 模拟器', path: path.join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices'), safe: true, category: 'dev', desc: 'iOS 模拟器数据，可重新创建' },
      { name: 'Go 模块缓存', path: path.join(home, 'go', 'pkg', 'mod'), safe: true, category: 'cache', desc: 'Go 模块下载缓存' },
      { name: 'Conda 缓存', path: path.join(home, 'miniconda3', 'pkgs'), safe: true, category: 'cache', desc: 'Conda 包缓存' },
      { name: 'Conda 缓存 (anaconda3)', path: path.join(home, 'anaconda3', 'pkgs'), safe: true, category: 'cache', desc: 'Anaconda 包缓存' },
      { name: 'Bun 缓存', path: path.join(home, '.bun', 'install', 'cache'), safe: true, category: 'cache', desc: 'Bun 包安装缓存' },
      { name: 'VS Code 扩展', path: path.join(home, '.vscode', 'extensions'), safe: false, category: 'ide', desc: 'VS Code 已安装的扩展' },
      { name: 'JetBrains 缓存', path: path.join(home, 'Library', 'Caches', 'JetBrains'), safe: true, category: 'ide', desc: 'JetBrains IDE 缓存' },
      { name: 'Slack 缓存', path: path.join(home, 'Library', 'Application Support', 'Slack', 'Cache'), safe: true, category: 'app', desc: 'Slack 聊天缓存' },
      { name: 'Discord 缓存', path: path.join(home, 'Library', 'Application Support', 'discord', 'Cache'), safe: true, category: 'app', desc: 'Discord 缓存' },
      { name: 'Spotify 缓存', path: path.join(home, 'Library', 'Caches', 'com.spotify.client'), safe: true, category: 'app', desc: 'Spotify 音乐缓存' },
      { name: '微信缓存', path: path.join(home, 'Library', 'Containers', 'com.tencent.xinWeChat'), safe: false, category: 'app', desc: '微信聊天文件和缓存' },
      { name: 'iOS 备份', path: path.join(home, 'Library', 'Application Support', 'MobileSync', 'Backup'), safe: false, category: 'backup', desc: 'iPhone/iPad 本地备份' },
      { name: 'Docker 磁盘映像', path: path.join(home, 'Library', 'Containers', 'com.docker.docker', 'Data', 'vms'), safe: false, category: 'vm', desc: 'Docker Desktop 虚拟磁盘' },
      { name: 'Parallels 虚拟机', path: path.join(home, 'Parallels'), safe: false, category: 'vm', desc: 'Parallels Desktop 虚拟机文件' },
    ];

    // Auto-discover ~/Library/Caches subdirectories
    const cachesDir = path.join(home, 'Library', 'Caches');
    if (fs.existsSync(cachesDir)) {
      try {
        const entries = fs.readdirSync(cachesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (['pip', 'Homebrew', 'CocoaPods', 'Google', 'Firefox', 'Microsoft Edge',
               'com.apple.Safari', 'JetBrains', 'com.spotify.client', 'yarn'].includes(entry.name)) continue;
          const fullPath = path.join(cachesDir, entry.name);
          try {
            const { stdout } = await execa('du', ['-sh', fullPath], { timeout: 10000, reject: false });
            const m = stdout?.match(/^(\S+)\s/);
            if (m) {
              const bytes = parseSizeToBytes(m[1]);
              if (bytes >= 100 * 1024 * 1024) {
                checks.push({ name: `${entry.name} 缓存`, path: fullPath, safe: false, category: 'app-cache', desc: `${entry.name} 应用缓存 (${m[1]})` });
              }
            }
          } catch {}
        }
      } catch {}
    }

    // Auto-discover node_modules in project directories
    for (const dir of ['Desktop', 'Documents', 'Projects', 'Developer', 'Code', 'Workspace', 'repos']) {
      const projectRoot = path.join(home, dir);
      if (!fs.existsSync(projectRoot)) continue;
      try {
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const nmPath = path.join(projectRoot, entry.name, 'node_modules');
          if (fs.existsSync(nmPath)) {
            checks.push({ name: `${entry.name}/node_modules`, path: nmPath, safe: true, category: 'dev', desc: `${entry.name} 项目的 node_modules` });
          }
        }
      } catch {}
    }

    // 3. Scan and stream items as they come
    const BATCH = 8;
    for (let i = 0; i < checks.length; i += BATCH) {
      const batch = checks.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async c => {
          if (!fs.existsSync(c.path)) return null;
          const info = await getDirSize(c.path);
          if (!info || info.bytes < 1024 * 1024) return null;
          return { name: c.name, path: c.path, size: info.size, bytes: info.bytes, safe: c.safe, category: c.category, description: c.desc };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          items.push(r.value);
          send('item', r.value);
        }
      }
    }

    // Docker check
    try {
      const { stdout } = await execa('docker', ['system', 'df', '--format', '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}'], { timeout: 10000, reject: false });
      if (stdout) {
        for (const line of stdout.trim().split('\n')) {
          const [type, size, reclaimable] = line.split('\t');
          const m = reclaimable?.match(/([\d.]+\s*[BKMGT])/);
          if (m && m[1] !== '0B') {
            const item = { name: `Docker ${type}`, path: `docker:${type.toLowerCase()}`, size: m[1], bytes: parseSizeToBytes(m[1]), safe: true, category: 'docker', description: `Docker 未使用的 ${type.toLowerCase()}` };
            items.push(item);
            send('item', item);
          }
        }
      }
    } catch {}

    items.sort((a, b) => b.bytes - a.bytes);

    // 4. Root directory overview — scan key top-level dirs
    let rootOverview = [];
    try {
      const rootScanDirs = ['/Users', '/Applications', '/Library', '/System', '/private', '/opt', '/usr/local', '/usr'];
      const rootResults = await Promise.allSettled(
        rootScanDirs.map(async d => {
          if (!fs.existsSync(d)) return null;
          const { stdout } = await execa('du', ['-sh', d], { timeout: 90000, reject: false });
          const m = stdout?.match(/^(\S+)\s/);
          if (!m) return null;
          return { name: d, fullPath: d, size: m[1], bytes: parseSizeToBytes(m[1]) };
        })
      );
      for (const r of rootResults) {
        if (r.status === 'fulfilled' && r.value) rootOverview.push(r.value);
      }
      rootOverview.sort((a, b) => b.bytes - a.bytes);
    } catch {}
    send('rootOverview', rootOverview);

    // 5. Home directory overview
    let homeOverview = [];
    try {
      const { stdout } = await execa('du', ['-d', '1', '-h', home], { timeout: 120000, reject: false });
      if (stdout) {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const match = line.match(/^(\S+)\s+(.*)/);
          if (!match || match[2] === home) continue;
          homeOverview.push({ name: path.basename(match[2]), fullPath: match[2], size: match[1], bytes: parseSizeToBytes(match[1]) });
        }
        homeOverview.sort((a, b) => b.bytes - a.bytes);
      }
    } catch {}
    send('homeOverview', homeOverview);

    // 5. Summary
    const safeItems = items.filter(i => i.safe);
    const reviewItems = items.filter(i => !i.safe);
    const safeBytes = safeItems.reduce((s, i) => s + i.bytes, 0);
    const reviewBytes = reviewItems.reduce((s, i) => s + i.bytes, 0);

    send('summary', {
      totalBytes: safeBytes + reviewBytes,
      totalSize: formatBytes(safeBytes + reviewBytes),
      safeBytes,
      safeSize: formatBytes(safeBytes),
      reviewBytes,
      reviewSize: formatBytes(reviewBytes),
      safeCount: safeItems.length,
      reviewCount: reviewItems.length,
    });

    send('done', null);
    res.end();
  } catch (error) {
    console.error('Cleanup scan error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to scan cleanup items' });
    } else {
      send('error', { message: error.message });
      res.end();
    }
  }
}

// ─── AI Cleanup Suggestions ───

async function getCleanupAi(req, res) {
  try {
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    const apiKey = await store.get('SILICONFLOW_API_KEY');
    if (!apiKey) {
      return res.status(400).json({ error: '请先在密钥管理中添加 SILICONFLOW_API_KEY' });
    }

    const scanItems = req.body.items || [];
    if (!scanItems.length) {
      return res.status(400).json({ error: '请先扫描可清理项' });
    }

    const homeOverview = req.body.homeOverview || [];
    const diskInfo = req.body.diskInfo || null;

    const now = Date.now();
    const monitorCacheData = (cache && (now - cacheTime < CACHE_TTL * 6)) ? cache : null;

    const itemList = scanItems.map(i => `- ${i.name}: ${i.size} (${i.path})${i.safe ? ' [安全]' : ' [需评估]'}`).join('\n');
    const systemInfo = monitorCacheData
      ? `CPU: ${monitorCacheData.cpu.model}, 内存: ${formatMem(monitorCacheData.memory.used)}/${formatMem(monitorCacheData.memory.total)}`
      : '未知';

    const diskLine = diskInfo
      ? `\n磁盘总量: ${diskInfo.total}, 已用: ${diskInfo.used}, 可用: ${diskInfo.available}, 使用率: ${diskInfo.capacity}`
      : '';

    const homeLine = homeOverview.length
      ? '\n\n家目录一级目录占用:\n' + homeOverview.slice(0, 20).map(i => `- ${i.name}: ${i.size}`).join('\n')
      : '';

    const prompt = `你是磁盘空间优化专家。分析以下扫描结果，给出清理建议。

系统: ${systemInfo}
平台: ${os.platform()}${diskLine}${homeLine}

可清理项:
${itemList}

扫描结果:
${itemList}

要求：
1. 对每个项目给出 delete（建议删除）、review（建议审查）、keep（建议保留）建议
2. 说明原因
3. 额外检查是否有遗漏的可清理项
4. 给出总体优化建议

用简洁的中文回复，格式如下：

## 清理建议

| 项目 | 建议 | 原因 |
|------|------|------|
| xxx | 删除/审查/保留 | ... |

## 额外发现
...

## 总体建议
...`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V3',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ type: 'error', message: `API 调用失败: ${response.status} ${errText.substring(0,200)}` })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processChunk = (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const data = JSON.parse(line.slice(6));
          const content = data.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
          }
        } catch {}
      }
    };

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processChunk(value);
      }
    };

    pump().then(() => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }).catch(err => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => { try { reader.cancel(); } catch {} });
  } catch (error) {
    console.error('AI cleanup error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to get AI suggestions' });
    }
  }
}

function formatMem(bytes) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// ─── Cleanup Delete ───

// Whitelist of safe-to-delete path patterns
const SAFE_DELETE_PATTERNS = [
  /^~\/\.npm\/_cacache$/,
  /^~\/\.cache\/yarn$/,
  /^~\/\.pnpm-store$/,
  /^~\/Library\/Caches\/pip$/,
  /^~\/Library\/Caches\/Homebrew$/,
  /^~\/\.m2\/repository$/,
  /^~\/\.gradle\/caches$/,
  /^~\/\.cargo\/registry$/,
  /^~\/Library\/Developer\/Xcode\/DerivedData$/,
  /^~\/Library\/Developer\/Xcode\/Archives$/,
  /^~\/Library\/Developer\/Xcode\/iOS DeviceSupport$/,
  /^~\/Library\/Caches\/CocoaPods$/,
  /^~\/\.Trash$/,
];

async function deleteCleanupItem(req, res) {
  try {
    const { itemPath } = req.body;
    if (!itemPath) return res.status(400).json({ error: 'itemPath is required' });

    // Skip Docker items
    if (itemPath.startsWith('docker:')) {
      const dockerType = itemPath.replace('docker:', '');
      const validTypes = { images: 'image', containers: 'container', volumes: 'volume', 'build cache': 'builder' };
      const dockerCmd = validTypes[dockerType];
      if (!dockerCmd) return res.status(400).json({ error: 'Invalid Docker type' });
      const { stdout } = await execa(`docker ${dockerCmd} prune -f`, { shell: true, timeout: 60000, reject: false });
      return res.json({ success: true, message: `Docker ${dockerType} 已清理` });
    }

    const resolved = itemPath.replace(/^~/, os.homedir());
    const home = os.homedir();

    // Security: verify path is under home and matches whitelist
    if (!resolved.startsWith(home)) {
      return res.status(403).json({ error: '路径不在用户目录下' });
    }

    const relativePath = '~/' + path.relative(home, resolved);
    const isWhitelisted = SAFE_DELETE_PATTERNS.some(p => p.test(relativePath));
    if (!isWhitelisted) {
      return res.status(403).json({ error: '该路径不在安全删除白名单中' });
    }

    if (!fs.existsSync(resolved)) {
      return res.json({ success: true, message: '路径已不存在' });
    }

    // Get size before deleting
    const beforeSize = await getDirSize(resolved);

    // Move to trash instead of rm -rf
    if (platform === 'darwin') {
      await execa('osascript', ['-e', `tell application "Finder" to delete POSIX file "${resolved}"`], { timeout: 30000 });
    } else {
      // Linux: use trash-cli if available, otherwise rm
      try {
        await execa('trash-put', [resolved], { timeout: 30000 });
      } catch {
        await execa('rm', ['-rf', resolved], { timeout: 30000 });
      }
    }

    res.json({
      success: true,
      freed: beforeSize ? beforeSize.size : 'unknown',
      freedBytes: beforeSize ? beforeSize.bytes : 0,
    });
  } catch (error) {
    console.error('Delete cleanup error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete' });
  }
}

// ─── Agent Session Store ───

const agentSessions = new Map();

async function confirmCleanupAgent(req, res) {
  const { sessionId, approved } = req.body;
  const session = agentSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: '会话不存在或已过期' });
  session.confirmResolve(approved ? true : false);
  agentSessions.delete(sessionId);
  res.json({ ok: true });
}

// ─── Agent Cleanup (Vercel AI SDK) ───

async function getCleanupAgent(req, res) {
  try {
    const { VaultStore } = require('../../vault/store');
    const store = new VaultStore();
    const apiKey = await store.get('SILICONFLOW_API_KEY');
    if (!apiKey) {
      return res.status(400).json({ error: '请先在密钥管理中添加 SILICONFLOW_API_KEY' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const scanItems = req.body.items || [];
    const homeOverview = req.body.homeOverview || [];
    const diskInfo = req.body.diskInfo || null;

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    const sendEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    sendEvent('session', { sessionId });

    const siliconflow = createOpenAI({
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKey,
    });

    const tools = {
      scan_directory: {
        description: '扫描指定目录下的一级子目录大小',
        parameters: z.object({
          path: z.string().describe('要扫描的目录路径'),
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
                  const info = await getDirSize(fullPath);
                  if (info && info.bytes > 1024 * 1024) {
                    return { name: entry.name, path: fullPath, size: info.size, bytes: info.bytes };
                  }
                  return null;
                })
              );
              for (const r of results) {
                if (r.status === 'fulfilled' && r.value) items.push(r.value);
              }
            }
            items.sort((a, b) => b.bytes - a.bytes);
            return JSON.stringify(items);
          } catch (err) {
            return JSON.stringify({ error: err.message });
          }
        },
      },
      get_disk_usage: {
        description: '获取磁盘总体使用情况',
        parameters: z.object({}),
        execute: async () => {
          try {
            const { stdout } = await execa.command('df -h /', { timeout: 5000, reject: false });
            return stdout || '无法获取磁盘信息';
          } catch {
            return '无法获取磁盘信息';
          }
        },
      },
      check_path_size: {
        description: '检查指定路径的大小',
        parameters: z.object({
          path: z.string().describe('要检查的路径'),
        }),
        execute: async ({ path: checkPath }) => {
          const resolved = checkPath.replace(/^~/, os.homedir());
          if (!fs.existsSync(resolved)) return JSON.stringify({ exists: false });
          const info = await getDirSize(resolved);
          return JSON.stringify({ exists: true, size: info?.size, bytes: info?.bytes });
        },
      },
      delete_path: {
        description: '删除指定路径（移到废纸篓）。所有删除操作都需要用户确认。',
        parameters: z.object({
          path: z.string().describe('要删除的路径'),
          reason: z.string().describe('删除原因'),
        }),
        execute: async ({ path: deletePath, reason }) => {
          const resolved = deletePath.replace(/^~/, os.homedir());
          const home = os.homedir();

          if (!resolved.startsWith(home)) {
            return JSON.stringify({ error: '路径不在用户目录下，拒绝删除' });
          }

          sendEvent('confirm_required', { sessionId, path: resolved, reason });
          const approved = await new Promise((resolve) => {
            agentSessions.set(sessionId, { confirmResolve: resolve });
          });
          if (!approved) {
            return JSON.stringify({ deleted: false, reason: '用户拒绝' });
          }

          if (!fs.existsSync(resolved)) {
            return JSON.stringify({ deleted: true, note: '路径已不存在' });
          }

          const beforeSize = await getDirSize(resolved);
          try {
            if (platform === 'darwin') {
              await execa('osascript', ['-e', `tell application "Finder" to delete POSIX file "${resolved}"`], { timeout: 30000 });
            } else {
              try {
                await execa('trash-put', [resolved], { timeout: 30000 });
              } catch {
                await execa('rm', ['-rf', resolved], { timeout: 30000 });
              }
            }
            sendEvent('deleted', { path: resolved, size: beforeSize?.size });
            return JSON.stringify({ deleted: true, freed: beforeSize?.size });
          } catch (err) {
            return JSON.stringify({ deleted: false, error: err.message });
          }
        },
      },
    };

    const systemPrompt = `你是磁盘空间清理专家 Agent。你可以使用工具扫描目录、查看大小、删除文件来帮用户清理磁盘空间。

工作流程：
1. 先分析已有的扫描数据，了解磁盘使用情况
2. 使用 scan_directory 深入查看可疑的大目录
3. 使用 check_path_size 确认具体路径大小
4. 使用 delete_path 清理确认可删除的文件（说明原因）
5. 所有删除操作都需要等待用户确认后才能执行
6. 给出最终清理报告

注意事项：
- 只删除确定安全的内容，不确定就先 scan_directory 查看
- 删除前总是 check_path_size 确认当前大小
- 不要删除用户文档、照片、项目代码等有价值的数据
- 用中文回复`;

    const itemList = scanItems.map(i => `- ${i.name}: ${i.size} (${i.path})${i.safe ? ' [安全]' : ' [需评估]'}`).join('\n');
    const homeLine = homeOverview.slice(0, 20).map(i => `${i.name}: ${i.size}`).join(', ');

    const userPrompt = `请帮我清理磁盘空间。以下是目前扫描到的数据：

磁盘信息: ${diskInfo ? JSON.stringify(diskInfo) : '未知'}
家目录分布: ${homeLine}
已发现的可清理项:
${itemList}

请分析这些数据，用工具进一步探查，然后执行清理。`;

    try {
      const result = streamText({
        model: siliconflow.chat('deepseek-ai/DeepSeek-V3'),
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
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
    console.error('Agent cleanup error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Agent 启动失败' });
    }
  }
}

module.exports = { getMonitor, getDu, getCleanupScan, getCleanupAi, deleteCleanupItem, getCleanupAgent, confirmCleanupAgent };
