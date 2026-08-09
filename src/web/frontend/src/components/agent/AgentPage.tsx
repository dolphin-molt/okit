import React, { useEffect, useState, useRef } from 'react';
import { listConversations, getConversation, createConversation, updateConversation, deleteConversation, agentChat, agentConfirm, type Conversation, type AgentMessage } from '../../api/agent';
import { getSettings, updateSettings, type AgentConfig } from '../../api/settings';
import { listProviders, type Provider } from '../../api/providers';
import { renderMd } from '../../lib/markdown';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import { ThinkingOrb } from 'thinking-orbs';

const DEFAULT_AGENT: AgentConfig = {
  provider: 'siliconflow',
  model: 'deepseek-ai/DeepSeek-V3',
  baseUrl: 'https://api.siliconflow.cn/v1',
  apiKeyVaultKey: 'SILICONFLOW_API_KEY',
};

export default function AgentPage() {
  const { showToast, confirm, setConnectionStatus, currentConvId, setCurrentConvId } = useApp() as any;
  const { t } = useI18n();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingBody, setStreamingBody] = useState<React.ReactElement[]>([]);
  const [waitingConfirm, setWaitingConfirm] = useState(false);
  const [orbState, setOrbState] = useState<'composing' | 'searching' | 'listening' | 'solving'>('composing');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(DEFAULT_AGENT);
  const [modelProviders, setModelProviders] = useState<Provider[]>([]);
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

  useEffect(() => {
    loadAgentConfig();
  }, []);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelPickerOpen]);

  async function loadAgentConfig() {
    try {
      const [settings, providersData] = await Promise.all([getSettings(), listProviders()]);
      setAgentConfig({ ...DEFAULT_AGENT, ...(settings.agent || {}) });
      setModelProviders(providersData.providers || []);
    } catch {}
  }

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

    const now = Date.now();
    const userMsg: AgentMessage = { role: 'user', content: text, timestamp: now };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setStreamingText('');
    setStreamingBody([]);
    setWaitingConfirm(false);
    setOrbState('composing');
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
        const assistantMsg: AgentMessage = { role: 'assistant', content: rawTextRef.current, timestamp: Date.now() };
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
      setOrbState('searching');
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
      setOrbState('solving');
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
      setWaitingConfirm(true);
      setOrbState('listening');
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
      setWaitingConfirm(false);
      setOrbState('solving');
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

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      showToast(t('vault.copySuccess'));
    } catch {
      showToast(t('vault.copyFail'), 'error');
    }
  }

  function formatMessageTime(timestamp?: number) {
    if (!timestamp) return t('agent.timeLegacy');
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function renderMessageMeta(content: string, timestamp?: number) {
    if (!content.trim()) return null;
    return (
      <div className="agent-msg-meta">
        <span className="agent-msg-time">{formatMessageTime(timestamp)}</span>
        <button className="agent-copy-btn" onClick={() => copyMessage(content)} title={t('vault.copy')}>
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="9" height="9" rx="1.5" />
            <path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12" />
          </svg>
          <span>{t('vault.copy')}</span>
        </button>
      </div>
    );
  }

  function pickSuggestion(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function renderSuggestionIcon(kind: 'tools' | 'system' | 'keys' | 'logs') {
    const common = {
      width: 18,
      height: 18,
      viewBox: '0 0 18 18',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
    };
    if (kind === 'tools') return <svg {...common}><path d="M6.5 3.5h5M6.5 9h5M6.5 14.5h5" /><path d="M3 3.5h.01M3 9h.01M3 14.5h.01" /></svg>;
    if (kind === 'system') return <svg {...common}><path d="M3 12l3-3 2 2 3.5-5 3.5 6" /><rect x="2" y="2" width="14" height="14" rx="2.5" /></svg>;
    if (kind === 'keys') return <svg {...common}><circle cx="6.5" cy="9" r="3" /><path d="M9.5 9H16M13 9v2M15 9v2" /></svg>;
    return <svg {...common}><path d="M4 3h10v12H4z" /><path d="M7 7h4M7 10h4M7 13h2" /></svg>;
  }

  const suggestions = [
    { key: 'tools', label: t('agent.suggest.tools'), prompt: '查看我的工具安装状态' },
    { key: 'system', label: t('agent.suggest.system'), prompt: '查看系统资源使用情况' },
    { key: 'keys', label: t('agent.suggest.keys'), prompt: '列出所有密钥' },
    { key: 'logs', label: t('agent.suggest.logs'), prompt: '查看最近的操作日志' },
  ] as const;

  const currentProvider = modelProviders.find(p => p.id === agentConfig.provider);
  const modelOptions = (currentProvider?.models || []).map(m => m.id);
  const composerModels = agentConfig.model && !modelOptions.includes(agentConfig.model)
    ? [agentConfig.model, ...modelOptions]
    : modelOptions;

  async function handleComposerModelChange(model: string, providerId?: string) {
    const next = { ...agentConfig, ...(providerId ? { provider: providerId } : {}), model };
    setAgentConfig(next);
    try {
      await updateSettings({ agent: { ...(providerId ? { provider: providerId } : {}), model } });
      showToast(t('common.success'));
    } catch {
      showToast(t('settings.saveFail'), 'error');
    }
  }

  return (
    <div className="agent-page">
      <div className="agent-topbar">
        <div className="agent-live-chip">
          <span />
          {t('agent.mode')}
        </div>
      </div>

      <div className="agent-messages">
        {messages.length === 0 && !streaming && (
          <div className="agent-welcome">
            <div className="agent-welcome-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M28 11.5c4.4 4.6 4.2 11.8-.2 16.1-4.6 4.4-11.8 4.2-16.1-.2-4.4-4.6-4.2-11.8.2-16.1 4.6-4.4 11.8-4.2 16.1.2z" />
                <path d="M14.5 20h11M20 14.5v11" />
                <path d="M31.5 8.5l-4 4M8.5 31.5l4-4" />
              </svg>
            </div>
            <div className="agent-welcome-copy">
              <h2>{t('agent.welcomeTitle')}</h2>
              <p>{t('agent.welcome')}</p>
            </div>
            <div className="agent-suggestions">
              {suggestions.map(item => (
                <button key={item.key} className="agent-suggestion" onClick={() => pickSuggestion(item.prompt)}>
                  <span className="agent-suggestion-icon">{renderSuggestionIcon(item.key)}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="agent-msg agent-msg-user">
                <div className="agent-msg-text">{msg.content}</div>
                {renderMessageMeta(msg.content, msg.timestamp)}
              </div>
            );
          }
          return (
            <div key={i} className="agent-msg agent-msg-assistant">
              <div className="agent-msg-body">
                <div className="agent-text" dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
              </div>
              {renderMessageMeta(msg.content, msg.timestamp)}
            </div>
          );
        })}
        {streaming && !streamingText && streamingBody.length === 0 && (
          <div className="agent-msg agent-msg-assistant agent-thinking">
            <div className="agent-msg-body agent-thinking-body">
              <ThinkingOrb state={orbState} size={20} speed={1.2} />
              <span className="agent-thinking-label">{
                orbState === 'listening' ? t('agent.waitingConfirm')
                : orbState === 'searching' ? t('agent.searching')
                : orbState === 'solving' ? t('agent.processing')
                : t('agent.thinking')
              }</span>
            </div>
          </div>
        )}
        {streaming && (streamingText || streamingBody.length > 0) && (
          <div className="agent-msg agent-msg-assistant">
            <div className="agent-msg-body">
              {streamingText && <div className="agent-text" dangerouslySetInnerHTML={{ __html: renderMd(streamingText) }} />}
              {streamingBody}
            </div>
            {renderMessageMeta(streamingText, Date.now())}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="agent-input-bar">
        <div className="agent-input-wrap">
          <textarea
            ref={inputRef}
            className="agent-input"
            placeholder={t('agent.placeholderShort')}
            rows={1}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            disabled={streaming}
          />
          <div className="agent-composer-row">
            <div className="agent-composer-left">
              <button className="agent-composer-btn" type="button" aria-label="Add">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M9 2.5v13M2.5 9h13" />
                </svg>
              </button>
              <div className="agent-model-picker" ref={modelPickerRef}>
                <button
                  type="button"
                  className="agent-model-trigger"
                  onClick={() => setModelPickerOpen(o => !o)}
                >
                  {agentConfig.model || 'Model'}
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                    <path d="M3 4.5L6 7.5L9 4.5" />
                  </svg>
                </button>
                {modelPickerOpen && (
                  <div className="agent-model-popover">
                    {modelProviders.map(p => {
                      const models = (p.models || []).map(m => m.id);
                      if (models.length === 0) return null;
                      return (
                        <div key={p.id} className="agent-model-group">
                          <div className="agent-model-group-title">{p.name || p.id}</div>
                          <div className="agent-model-items">
                            {models.map(m => (
                              <button
                                key={m}
                                type="button"
                                className={`agent-model-item ${agentConfig.provider === p.id && agentConfig.model === m ? 'active' : ''}`}
                                onClick={() => { handleComposerModelChange(m, p.id); setModelPickerOpen(false); }}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="agent-composer-right">
              <button className="agent-send-btn" onClick={sendMessage} disabled={streaming || !input.trim()} aria-label={t('agent.send')}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 15V3" />
                  <path d="M4 8l5-5 5 5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
