import React, { useEffect, useState, useRef } from 'react';
import { listConversations, getConversation, createConversation, updateConversation, deleteConversation, agentChat, agentConfirm, type Conversation, type AgentMessage, type AgentImage, type AgentConfirm } from '../../api/agent';
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
  const waitingConfirmRef = useRef(false);
  const streamingBodyRef = useRef<React.ReactElement[]>([]);
  const toolResultRef = useRef(''); // accumulates tool result text after confirmation
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImages, setPendingImages] = useState<AgentImage[]>([]);

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
    const imgs = pendingImages.length > 0 ? [...pendingImages] : undefined;
    if ((!text && !imgs) || streaming) return;

    const now = Date.now();
    const userMsg: AgentMessage = { role: 'user', content: text, timestamp: now, images: imgs };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setPendingImages([]);
    setStreaming(true);
    setStreamingText('');
    setStreamingBody([]);
    streamingBodyRef.current = [];
    toolResultRef.current = '';
    setWaitingConfirm(false);
    waitingConfirmRef.current = false;
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

      // Persist the assistant's reply after the stream ends.
      // Use model text (rawTextRef) if available; otherwise fall back to
      // accumulated tool result text so the user sees what happened.
      const replyContent = rawTextRef.current.trim() || toolResultRef.current.trim();
      if (replyContent) {
        const assistantMsg: AgentMessage = { role: 'assistant', content: replyContent, timestamp: Date.now() };
        setMessages(prev => {
          const next = [...prev, assistantMsg];
          saveConv(next);
          return next;
        });
      }
      rawTextRef.current = '';
      toolResultRef.current = '';
      setStreamingText('');
      streamingBodyRef.current = [];
      setStreamingBody([]);
    } catch (e: any) {
      if (e.name !== 'AbortError') showToast(t('agent.sendFail'), 'error');
    } finally {
      setStreaming(false);
    }
  }

  function pushToStreamingBody(el: React.ReactElement) {
    setStreamingBody(prev => {
      const next = [...prev, el];
      streamingBodyRef.current = next;
      return next;
    });
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
        get_logs: t('agent.suggest.logs'), get_settings: t('nav.settings'), update_settings: t('common.save'),
      };
      const label = toolLabels[data.tool] || data.tool;
      let argsText = '';
      if (data.args) {
        try {
          const args = typeof data.args === 'string' ? JSON.parse(data.args) : data.args;
          argsText = Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(', ');
        } catch { argsText = JSON.stringify(data.args); }
      }
      pushToStreamingBody(<div key={streamingBodyRef.current.length} className="agent-tool-call"><span className="agent-tool-name">{label}</span><span className="agent-tool-args">{argsText}</span></div>);
    } else if (type === 'tool_result') {
      setOrbState('solving');
      // Accumulate tool result text so it can be persisted as a message
      try {
        const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        if (parsed?.message) toolResultRef.current += parsed.message + '\n';
        else if (parsed?.error) toolResultRef.current += '错误: ' + parsed.error + '\n';
        else if (parsed?.success && parsed.vaultKey) toolResultRef.current += `操作成功（${parsed.vaultKey}）\n`;
        else if (parsed?.success) toolResultRef.current += '操作成功\n';
      } catch {}
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
        streamingBodyRef.current = next;
        return next;
      });
    } else if (type === 'confirm_required') {
      setWaitingConfirm(true);
      waitingConfirmRef.current = true;
      setOrbState('listening');
      // Persist the confirmation as an assistant message so it survives reloads
      const confirmMsg: AgentMessage = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        confirm: {
          sessionId: data.sessionId || sessionIdRef.current || '',
          action: data.action || '',
          target: data.target || '',
          reason: data.reason,
          status: 'pending',
        },
      };
      setMessages(prev => {
        const next = [...prev, confirmMsg];
        saveConv(next);
        return next;
      });
    } else if (type === 'error') {
      pushToStreamingBody(<div key={streamingBodyRef.current.length} className="ai-error">{data.message || t('agent.error')}</div>);
    }
  }

  async function handleConfirm(approved: boolean, msgIdx: number) {
    const msg = messages[msgIdx];
    if (!msg?.confirm) return;
    try {
      await agentConfirm(msg.confirm.sessionId, approved);
      setWaitingConfirm(false);
      waitingConfirmRef.current = false;
      setOrbState('solving');
      setMessages(prev => {
        const next = [...prev];
        if (next[msgIdx]?.confirm) {
          next[msgIdx] = { ...next[msgIdx], confirm: { ...next[msgIdx].confirm!, status: approved ? 'confirmed' : 'rejected' } };
        }
        saveConv(next);
        return next;
      });
    } catch (e: any) {
      // Session may have expired (e.g. server timeout). Inform the user.
      setWaitingConfirm(false);
      waitingConfirmRef.current = false;
      showToast(t('agent.confirmExpired'), 'error');
      setMessages(prev => {
        const next = [...prev];
        if (next[msgIdx]?.confirm) {
          next[msgIdx] = { ...next[msgIdx], confirm: { ...next[msgIdx].confirm!, status: 'expired' } };
        }
        saveConv(next);
        return next;
      });
    }
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
        <button className="agent-copy-btn" onClick={() => copyMessage(content)} title={t('vault.copy')} aria-label={t('vault.copy')}>
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="9" height="9" rx="1.5" />
            <path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12" />
          </svg>
        </button>
      </div>
    );
  }

  // ─── 图片上传支持 ───
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

  /** 启发式判断模型是否支持视觉输入 */
  function isVisionModel(modelId: string): boolean {
    const id = modelId.toLowerCase();
    // 明确的非视觉模型
    if (/deepseek-v3(?!.*flash)|deepseek-ai\/deepseek-v3(?!.*flash)/.test(id)) return false;
    if (/embedding|tts|whisper|speech/.test(id)) return false;
    // 已知视觉模型关键词
    return /vision|vl|v4-flash|glm-4v|glm-4\.6|qwen-vl|qwen2-vl|qvq|gpt-4o|gpt-4-turbo|gemini|claude-3|claude-sonnet|claude-opus|claude-haiku|llava|minicpm|internvl|grok-vision/.test(id);
  }

  function handlePickImages() {
    fileInputRef.current?.click();
  }

  function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const valid: File[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) { showToast(t('agent.imageTypeInvalid'), 'error'); continue; }
      if (f.size > MAX_IMAGE_SIZE) { showToast(t('agent.imageTooLarge'), 'error'); continue; }
      valid.push(f);
    }
    if (valid.length === 0) return;

    let readCount = 0;
    const results: AgentImage[] = [];
    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        results.push({ data: base64, mimeType: file.type });
        readCount++;
        if (readCount === valid.length) {
          setPendingImages(prev => [...prev, ...results]);
          // 非视觉模型温和提示(不阻止)
          if (!isVisionModel(agentConfig.model)) {
            showToast(t('agent.visionModelHint', { model: agentConfig.model }), 'info');
          }
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function removePendingImage(idx: number) {
    setPendingImages(prev => prev.filter((_, i) => i !== idx));
  }

  function pickSuggestion(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function renderSuggestionIcon(kind: 'tools' | 'keys' | 'logs') {
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
    if (kind === 'keys') return <svg {...common}><circle cx="6.5" cy="9" r="3" /><path d="M9.5 9H16M13 9v2M15 9v2" /></svg>;
    return <svg {...common}><path d="M4 3h10v12H4z" /><path d="M7 7h4M7 10h4M7 13h2" /></svg>;
  }

  const suggestions = [
    { key: 'tools', label: t('agent.suggest.tools'), prompt: '查看我的工具安装状态' },
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
          // Skip empty assistant messages (no text, no confirm)
          if (msg.role === 'assistant' && !msg.content?.trim() && !msg.confirm) return null;
          if (msg.role === 'user') {
            return (
              <div key={i} className="agent-msg agent-msg-user">
                {msg.images && msg.images.length > 0 && (
                  <div className="agent-msg-images">
                    {msg.images.map((img, idx) => (
                      <img key={idx} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="agent-msg-image" />
                    ))}
                  </div>
                )}
                {msg.content && <div className="agent-msg-text">{msg.content}</div>}
                {renderMessageMeta(msg.content, msg.timestamp)}
              </div>
            );
          }
          return (
            <div key={i} className="agent-msg agent-msg-assistant">
              {msg.content?.trim() && (
                <div className="agent-msg-body">
                  <div className="agent-text" dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
                </div>
              )}
              {msg.confirm && (
                <div className="agent-confirm">
                  <div className="agent-confirm-msg">{msg.confirm.action}: <code>{msg.confirm.target}</code></div>
                  {msg.confirm.reason && <div className="agent-confirm-reason">{msg.confirm.reason}</div>}
                  {msg.confirm.status === 'pending' ? (
                    <div className="agent-confirm-actions">
                      <button className="agent-confirm-yes" onClick={() => handleConfirm(true, i)}>{t('common.confirm')}</button>
                      <button className="agent-confirm-no" onClick={() => handleConfirm(false, i)}>{t('common.cancel')}</button>
                    </div>
                  ) : (
                    <div className={`agent-confirm-status agent-confirm-status--${msg.confirm.status}`}>
                      {msg.confirm.status === 'confirmed' && `✓ ${t('agent.confirmed')}`}
                      {msg.confirm.status === 'rejected' && `✕ ${t('agent.rejected')}`}
                      {msg.confirm.status === 'expired' && t('agent.confirmExpired')}
                    </div>
                  )}
                </div>
              )}
              {msg.content?.trim() && renderMessageMeta(msg.content, msg.timestamp)}
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
        {streaming && streamingText && (
          <div className="agent-msg agent-msg-assistant">
            <div className="agent-msg-body">
              <div className="agent-text" dangerouslySetInnerHTML={{ __html: renderMd(streamingText) }} />
            </div>
            {renderMessageMeta(streamingText, Date.now())}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="agent-input-bar">
        <div className="agent-input-wrap">
          {pendingImages.length > 0 && (
            <div className="agent-attachment-bar">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="agent-attachment-thumb">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" className="agent-attachment-remove" onClick={() => removePendingImage(idx)} aria-label={t('agent.removeImage')}>×</button>
                </div>
              ))}
            </div>
          )}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleFilesSelected(e.target.files); if (e.target) e.target.value = ''; }}
          />
          <div className="agent-composer-row">
            <div className="agent-composer-left">
              <button className="agent-composer-btn" type="button" aria-label={t('agent.attachImage')} onClick={handlePickImages} title={t('agent.attachImage')}>
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
