import { api, readSSELines } from './client';

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  type: string;
  status: 'installed' | 'not_installed' | 'partial' | 'updating';
  version?: string;
  latestVersion?: string;
  authRequired?: boolean;
  authStatus?: 'authorized' | 'unauthorized' | 'partial';
  homepage?: string;
  installGuide?: string;
}

export interface ToolsResponse {
  tools: Tool[];
  summary: Record<string, number>;
}

export async function getTools(refresh = false, lang = 'zh'): Promise<ToolsResponse> {
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', '1');
  if (lang && lang !== 'zh') params.set('lang', lang);
  const qs = params.toString();
  const url = qs ? `/api/tools?${qs}` : '/api/tools';
  return api<ToolsResponse>(url);
}

export interface ActionEvent {
  type: 'output' | 'error' | 'complete' | 'auth_url' | 'auth_code_required' | 'success' | 'warning';
  message?: string;
  data?: any;
}

export async function* executeAction(
  toolId: string,
  action: string,
  options?: Record<string, string>,
): AsyncGenerator<ActionEvent> {
  const res = await fetch('/api/tools/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, action, ...options }),
  });

  for await (const line of readSSELines(res)) {
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

export async function submitAuthCode(toolId: string, code: string): Promise<any> {
  return api('/api/tools/auth-code', {
    method: 'POST',
    body: JSON.stringify({ toolId, code }),
  });
}

export async function openApp(toolId: string): Promise<any> {
  return api('/api/tools/open', {
    method: 'POST',
    body: JSON.stringify({ toolId }),
  });
}
