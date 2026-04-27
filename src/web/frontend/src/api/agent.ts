import { api, readSSELines } from './client';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  toolCalls?: any[];
}

export async function listConversations(): Promise<Conversation[]> {
  return api('/api/agent/conversations');
}

export async function getConversation(id: string): Promise<AgentMessage[]> {
  return api(`/api/agent/conversations/${id}`);
}

export async function createConversation(): Promise<Conversation> {
  return api('/api/agent/conversations', { method: 'POST', body: '{}' });
}

export async function updateConversation(id: string, data: { messages?: AgentMessage[]; title?: string }): Promise<{ ok: boolean }> {
  return api(`/api/agent/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteConversation(id: string): Promise<{ ok: boolean }> {
  return api(`/api/agent/conversations/${id}`, { method: 'DELETE' });
}

export interface ChatEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'confirm_required' | 'done' | 'error';
  content?: string;
  data?: any;
}

export async function* agentChat(messages: AgentMessage[]): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  for await (const line of readSSELines(res)) {
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

export async function agentConfirm(confirmId: string, approved: boolean): Promise<any> {
  return api('/api/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({ id: confirmId, approved }),
  });
}
