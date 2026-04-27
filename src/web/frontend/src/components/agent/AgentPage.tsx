import React, { useEffect, useState, useRef } from 'react';
import { listConversations, getConversation, createConversation, updateConversation, deleteConversation, agentChat, agentConfirm, type Conversation, type AgentMessage } from '../../api/agent';
import { renderMd } from '../../lib/markdown';
import { useApp } from '../Layout/AppContext';

export default function AgentPage() {
  const { showToast, confirm, setConnectionStatus, currentConvId, setCurrentConvId } = useApp() as any;
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingBody, setStreamingBody] = useState<React.ReactElement[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rawTextRef = useRef('');
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentConvId) loadConv(currentConvId);
    else initConv();
  }, [currentConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingBody]);

  async function initConv() {
    try {
      const list = await listConversations();
      if (list.length > 0) {
        setCurrentConvId(list[0].id);
      } else {
        const conv = await createConversation();
        setCurrentConvId(conv.id);
      }
    } catch {}
  }

  async function loadConv(id: string) {
    try {
      const msgs = await getConversation(id);
      setMessages(msgs);
    } catch {}
  }

  async function saveConv(msgs?: AgentMessage[]) {
    if (!currentConvId) return;
    const m = msgs || messages;
    if (m.length === 0) return;
    const title = m.find(m => m.role === 'user')?.content?.slice(0, 20) || '新对话';
    try {
      await updateConversation(currentConvId, { messages: m, title });
    } catch {}
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: AgentMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setStreamingText('');
    setStreamingBody([]);
    rawTextRef.current = '';

    if (inputRef.current) inputRef.current.style.height = 'auto';
    saveConv(newMessages);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            handleEvent(event);
          } catch {}
        }
      }

      if (rawTextRef.current) {
        const assistantMsg: AgentMessage = { role: 'assistant', content: rawTextRef.current };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamingText('');
        setStreamingBody([]);
        saveConv([...newMessages, assistantMsg]);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') showToast('发送失败', 'error');
    } finally {
      setStreaming(false);
    }
  }

  function handleEvent(event: any) {
    const type = event.type;
    const data = event.data || event;

    if (type === 'session') {
      sessionIdRef.current = data.sessionId;
    } else if (type === 'text') {
      rawTextRef.current += data.content || '';
      setStreamingText(rawTextRef.current);
    } else if (type === 'tool_call') {
      rawTextRef.current = '';
      const toolLabels: Record<string, string> = {
        list_tools: '查看工具', install_tool: '安装', upgrade_tool: '升级', uninstall_tool: '卸载', open_app: '打开应用',
        list_vault_keys: '列出密钥', get_vault_value: '查看密钥', set_vault_key: '设置密钥', delete_vault_key: '删除密钥',
        get_system_info: '系统信息', get_disk_usage: '磁盘占用', get_logs: '操作日志', get_settings: '查看配置', update_settings: '更新配置',
      };
      const label = toolLabels[data.tool] || data.tool;
      let argsText = '';
      if (data.args) {
        try {
          const args = typeof data.args === 'string' ? JSON.parse(data.args) : data.args;
          argsText = Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(', ');
        } catch { argsText = JSON.stringify(data.args); }
      }
      setStreamingBody(prev => [...prev, <div key={prev.length} className="agent-tool-call"><span className="agent-tool-name">{label}</span><span className="agent-tool-args">{argsText}</span></div>]);
    } else if (type === 'tool_result') {
      setStreamingBody(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && (last as any).props?.className === 'agent-tool-call') {
          let resultText = '完成';
          try {
            const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
            if (Array.isArray(parsed)) resultText = parsed.slice(0, 3).map((i: any) => i.name || i.key || JSON.stringify(i)).join(', ') + (parsed.length > 3 ? ` ...等${parsed.length}项` : '');
            else if (parsed?.error) resultText = '错误: ' + parsed.error;
            else if (parsed?.success) resultText = '成功';
            else resultText = JSON.stringify(parsed).substring(0, 100);
          } catch { resultText = String(data.result).substring(0, 100); }
          next[next.length - 1] = <div key={next.length - 1} className="agent-tool-call agent-tool-done"><span className="agent-tool-name">{(last.props as any).children[0].props.children}</span><span className="agent-tool-args">{(last.props as any).children[1].props.children}</span><div className="agent-tool-result">{resultText}</div></div>;
        }
        return next;
      });
    } else if (type === 'confirm_required') {
      setStreamingBody(prev => [...prev,
        <div key={prev.length} className="agent-confirm">
          <div className="agent-confirm-msg">{data.action}: <code>{data.target}</code></div>
          {data.reason && <div className="agent-confirm-reason">{data.reason}</div>}
          <div className="agent-confirm-actions">
            <button className="agent-confirm-yes" onClick={() => handleConfirm(true, prev.length)}>确认</button>
            <button className="agent-confirm-no" onClick={() => handleConfirm(false, prev.length)}>取消</button>
          </div>
        </div>
      ]);
    } else if (type === 'error') {
      setStreamingBody(prev => [...prev, <div key={prev.length} className="ai-error">{data.message || '出错了'}</div>]);
    }
  }

  async function handleConfirm(approved: boolean, idx: number) {
    try {
      await agentConfirm(sessionIdRef.current || '', approved);
      setStreamingBody(prev => {
        const next = [...prev];
        next[idx] = <div key={idx} className={approved ? 'agent-deleted' : 'agent-confirm-rejected'}>{approved ? '用户已确认' : '用户已拒绝'}</div>;
        return next;
      });
    } catch {}
  }

  function autoResize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  return (
    <div className="agent-page">
      <div className="agent-messages">
        {messages.length === 0 && !streaming && (
          <div className="agent-welcome">
            <div className="agent-welcome-icon">
              <svg width="32" height="32" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 9c0 3.3-2.5 6-5.5 6-.9 0-1.7-.2-2.5-.5L3 16l1-3C3.4 11.7 3 10.4 3 9c0-3.3 2.5-6 5.5-6S14 5.7 14 9z" fill="currentColor" opacity="0.15" />
                <circle cx="6.5" cy="9" r="0.8" fill="currentColor" />
                <circle cx="9" cy="9" r="0.8" fill="currentColor" />
                <circle cx="11.5" cy="9" r="0.8" fill="currentColor" />
              </svg>
            </div>
            <p>你好！我是 OKIT 智能助手，可以帮你管理开发工具、密钥和系统资源。</p>
            <div className="agent-suggestions">
              <button className="agent-suggestion" onClick={() => setInput('查看我的工具安装状态')}>查看工具状态</button>
              <button className="agent-suggestion" onClick={() => setInput('查看系统资源使用情况')}>查看系统资源</button>
              <button className="agent-suggestion" onClick={() => setInput('列出所有密钥')}>列出密钥</button>
              <button className="agent-suggestion" onClick={() => setInput('查看最近的操作日志')}>查看日志</button>
            </div>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="agent-msg agent-msg-user">
                <div className="agent-msg-text">{msg.content}</div>
              </div>
            );
          }
          return (
            <div key={i} className="agent-msg agent-msg-assistant">
              <div className="agent-msg-body">
                <div className="agent-text" dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
              </div>
            </div>
          );
        })}
        {streaming && (streamingText || streamingBody.length > 0) && (
          <div className="agent-msg agent-msg-assistant">
            <div className="agent-msg-body">
              {streamingText && <div className="agent-text" dangerouslySetInnerHTML={{ __html: renderMd(streamingText) }} />}
              {streamingBody}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="agent-input-bar">
        <div className="agent-input-wrap">
          <textarea
            ref={inputRef}
            className="agent-input"
            placeholder="给 OKIT 助手发消息..."
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            disabled={streaming}
          />
          <button className="agent-send-btn" onClick={sendMessage} disabled={streaming || !input.trim()}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l12-6-6 12V9H3z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
