import { api, readSSELines } from './client';

export interface SystemStats {
  cpu: { usage: number; cores: number; model: string; loadAvg: number[] };
  memory: { total: number; used: number; usagePercent: number; swap?: { total: string; used: string } };
  disk: { filesystem: string; size: string; used: string; available: string; capacity: string; mount: string }[];
  gpu?: { model: string; vram: string } | { name: string; usage: number; memory: number }[];
  uptime: number;
  hostname?: string;
}

export async function getMonitor(): Promise<SystemStats> {
  return api('/api/monitor');
}

export interface DuEntry {
  path: string;
  size: number;
  children?: DuEntry[];
}

export async function getDu(dirPath: string): Promise<DuEntry[]> {
  return api(`/api/monitor/du?path=${encodeURIComponent(dirPath)}`);
}

export interface CleanupItem {
  category: string;
  path: string;
  size: number;
  description: string;
}

export async function* scanCleanup(): AsyncGenerator<CleanupItem> {
  const res = await fetch('/api/monitor/cleanup-scan');
  for await (const line of readSSELines(res)) {
    try {
      const items = JSON.parse(line);
      if (Array.isArray(items)) for (const item of items) yield item;
      else yield items;
    } catch {}
  }
}

export async function deleteCleanupItems(paths: string[]): Promise<{ deleted: number }> {
  return api('/api/monitor/cleanup-delete', {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });
}

export async function* aiCleanup(prompt: string): AsyncGenerator<any> {
  const res = await fetch('/api/monitor/cleanup-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  for await (const line of readSSELines(res)) {
    try { yield JSON.parse(line); } catch {}
  }
}
