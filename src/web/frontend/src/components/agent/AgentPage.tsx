import React, { useEffect, useState, useRef } from 'react';
import { listConversations, getConversation, createConversation, updateConversation, deleteConversation, agentChat, agentConfirm, type Conversation, type AgentMessage } from '../../api/agent';
import { renderMd } from '../../lib/markdown';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function AgentPage() {
  const { showToast, confirm, setConnectionStatus, currentConvId, setCurrentConvId } = useApp() as any;
  const { t } = useI18n();
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
      if (e.name !== 'AbortError') showToast(t('agent.sendFail'), 'error');
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
        list_tools: t('agent.suggest.tools'), install_tool: t('common.install'), upgrade_tool: t('common.upgrade'), uninstall_tool: t('common.uninstall'), open_app: t('common.open'),
        list_vault_keys: t('agent.suggest.keys'), get_vault_value: t('agent.suggest.keys'), set_vault_key: t('common.save'), delete_vault_key: t('common.delete'),
        get_system_info: t('agent.suggest.system'), get_disk_usage: t('monitor.disk'), get_logs: t('agent.suggest.logs'), get_settings: t('nav.settings'), update_settings: t('common.save'),
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
          let resultText = t('agent.completed');
          try {
            const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
            if (Array.isArray(parsed)) resultText = parsed.slice(0, 3).map((i: any) => i.name || i.key || JSON.stringify(i)).join(', ') + (parsed.length > 3 ? ` ...${parsed.length}` : '');
            else if (parsed?.error) resultText = t('common.failed') + ': ' + parsed.error;
            else if (parsed?.success) resultText = t('common.success');
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
            <button className="agent-confirm-yes" onClick={() => handleConfirm(true, prev.length)}>{t('common.confirm')}</button>
            <button className="agent-confirm-no" onClick={() => handleConfirm(false, prev.length)}>{t('common.cancel')}</button>
          </div>
        </div>
      ]);
    } else if (type === 'error') {
      setStreamingBody(prev => [...prev, <div key={prev.length} className="ai-error">{data.message || t('agent.error')}</div>]);
    }
  }

  async function handleConfirm(approved: boolean, idx: number) {
    try {
      await agentConfirm(sessionIdRef.current || '', approved);
      setStreamingBody(prev => {
        const next = [...prev];
        next[idx] = <div key={idx} className={approved ? 'agent-deleted' : 'agent-confirm-rejected'}>{approved ? t('agent.confirmed') : t('agent.rejected')}</div>;
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
            <p>{t('agent.welcome')}</p>
            <div className="agent-suggestions">
              <button className="agent-suggestion" onClick={() => setInput('查看我的工具安装状态')}>{t('agent.suggest.tools')}</button>
              <button className="agent-suggestion" onClick={() => setInput('查看系统资源使用情况')}>{t('agent.suggest.system')}</button>
              <button className="agent-suggestion" onClick={() => setInput('列出所有密钥')}>{t('agent.suggest.keys')}</button>
              <button className="agent-suggestion" onClick={() => setInput('查看最近的操作日志')}>{t('agent.suggest.logs')}</button>
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
            placeholder={t('agent.placeholder')}
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
