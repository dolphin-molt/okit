import { useEffect, useState, useCallback, useRef } from 'react';
import { getAdapters, switchProvider, addHomeProvider, removeHomeProvider, disableAgentProvider, getAgentConfigFiles, saveAgentConfigFile, getCatalogExcluded, setCatalogExcluded, getTierMaps, setTierMap, AgentInfo, AgentConfigFile, TierMap } from '../../api/providers';
import { useI18n } from '../../i18n';
import { useApp } from '../Layout/AppContext';
import { getAgentIcon, getAgentIconClass } from '../../assets/agents';
import { getProviderIcon, getProviderIconClass } from '../../assets/providers';
import JsonTreeView from '../shared/JsonTreeView';
import { Eye, Copy, Save, RefreshCw, X, Plus, FileJson, Loader2, Check } from 'lucide-react';
import UsageSummary from './UsageSummary';

const AGENT_ORDER_KEY = 'okit.agentOrder';

function loadSavedAgentOrder(): string[] {
  try {
    const raw = localStorage.getItem(AGENT_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveAgentOrder(ids: string[]): void {
  try {
    localStorage.setItem(AGENT_ORDER_KEY, JSON.stringify(ids));
  } catch {}
}

function applySavedAgentOrder(list: AgentInfo[]): AgentInfo[] {
  const saved = loadSavedAgentOrder();
  if (!saved.length) return list;
  const byId = new Map(list.map(a => [a.id, a]));
  const ordered: AgentInfo[] = [];
  for (const id of saved) {
    const agent = byId.get(id);
    if (agent && !ordered.includes(agent)) ordered.push(agent);
  }
  for (const agent of list) {
    if (!ordered.includes(agent)) ordered.push(agent);
  }
  return ordered;
}

export default function HomePage() {
  const { t } = useI18n();
  const { showToast } = useApp();
  const [adapters, setAdapters] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  // Which provider cards have "show all models" expanded.
  const [showAllModels, setShowAllModels] = useState<Set<string>>(new Set());
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [configFiles, setConfigFiles] = useState<AgentConfigFile[] | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [activeConfigTab, setActiveConfigTab] = useState(0);
  // Editable drafts: maps file path → edited content. A file is "dirty" when
  // its draft differs from the original content loaded from disk.
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});
  const [configSaveState, setConfigSaveState] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');
  const configSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Config viewer display mode: 'raw' shows the editable textarea,
  // 'tree' toggles to a collapsible JSON tree preview.
  const [configViewMode, setConfigViewMode] = useState<'tree' | 'raw'>('raw');
  // Per-provider model visibility filter. Maps providerId → modelIds the
  // user has UNCHECKED (hidden from the card). Absent or empty = all models
  // visible. The current/active model can't be unchecked (its checkbox is
  // disabled) to avoid "current model hidden" weirdness.
  const [modelExcluded, setModelExcluded] = useState<Record<string, string[]>>({});
  // Models the user explicitly restored from the "add models" picker even
  // though they're tagged recent=false by the backend. These render in the
  // main list alongside recent models.
  const [extraVisible, setExtraVisible] = useState<Record<string, Set<string>>>({});
  // "Add models" picker — which provider's hidden-model picker is open.
  const [addModelPickerFor, setAddModelPickerFor] = useState<string | null>(null);
  // Claude Code tier maps: per-provider { haiku, sonnet, opus } model overrides.
  const [tierMaps, setTierMaps] = useState<Record<string, TierMap>>({});
  // Agent tab drag-to-reorder.
  const [dragTabIndex, setDragTabIndex] = useState<number | null>(null);
  const [dropTabIndex, setDropTabIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getAdapters();
      const list = data.adapters || [];
      const ordered = applySavedAgentOrder(list);
      setAdapters(ordered);
      // Only seed the active agent on the very first load. Use the functional
      // form so we read the latest activeAgentId — otherwise the closure would
      // capture the initial null forever and reset the tab to list[0] on every
      // reload (e.g. after a switch), yanking the user back to Claude.
      setActiveAgentId(prev => (prev == null && ordered.length > 0 ? ordered[0].id : prev));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleAddHome = useCallback(async (providerId: string) => {
    if (!activeAgentId) return;
    try {
      await addHomeProvider(activeAgentId, providerId);
      await load();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [activeAgentId, load, showToast]);

  const handleRemoveHome = useCallback(async (providerId: string) => {
    if (!activeAgentId) return;
    try {
      await removeHomeProvider(activeAgentId, providerId);
      await load();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [activeAgentId, load, showToast]);

  const handleDropTab = useCallback((targetIndex: number) => {
    setDragTabIndex(from => {
      if (from === null || from === targetIndex) return null;
      setAdapters(prev => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(from < targetIndex ? targetIndex - 1 : targetIndex, 0, moved);
        saveAgentOrder(next.map(a => a.id));
        return next;
      });
      return null;
    });
    setDropTabIndex(null);
  }, []);

  const handleViewConfig = useCallback(async () => {
    if (!activeAgentId) return;
    setConfigLoading(true);
    setConfigFiles([]);
    setActiveConfigTab(0);
    setConfigDrafts({});
    setConfigViewMode('raw');
    try {
      const res = await getAgentConfigFiles(activeAgentId);
      setConfigFiles(res.files);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setConfigLoading(false);
    }
  }, [activeAgentId, showToast]);

  const handleSaveConfig = useCallback(async (filePath: string) => {
    if (!activeAgentId) return;
    const content = configDrafts[filePath];
    if (content === undefined) return;
    if (configSaveTimer.current) clearTimeout(configSaveTimer.current);
    setConfigSaveState('saving');
    try {
      await saveAgentConfigFile(activeAgentId, filePath, content);
      // Commit the draft as the new "original" so the file is no longer dirty.
      setConfigFiles(prev => prev ? prev.map(f => f.path === filePath ? { ...f, content } : f) : prev);
      setConfigDrafts(prev => { const n = { ...prev }; delete n[filePath]; return n; });
      setConfigSaveState('ok');
      showToast(t('home.configSaved'), 'success');
    } catch (err: any) {
      setConfigSaveState('fail');
      showToast(err.message, 'error');
    } finally {
      configSaveTimer.current = setTimeout(() => setConfigSaveState('idle'), 1600);
    }
  }, [activeAgentId, configDrafts, showToast, t]);

  useEffect(() => () => {
    if (configSaveTimer.current) clearTimeout(configSaveTimer.current);
  }, []);

  const handleCopyConfig = useCallback(async (filePath: string) => {
    const draft = configDrafts[filePath];
    const original = configFiles?.find(f => f.path === filePath)?.content ?? '';
    try {
      await navigator.clipboard.writeText(draft !== undefined ? draft : original);
      showToast(t('home.configCopied'), 'success');
    } catch {
      showToast(t('common.error'), 'error');
    }
  }, [configDrafts, configFiles, showToast, t]);

  // Load model visibility exclusions + claude tier maps once on mount.
  useEffect(() => {
    getCatalogExcluded().then(res => setModelExcluded(res.excluded || {})).catch(() => {});
    getTierMaps().then(res => setTierMaps(res.tierMaps || {})).catch(() => {});
  }, []);

  const activeAgent = adapters.find(a => a.id === activeAgentId) || null;

  // Toggle a model's visibility in its provider card. Unchecking hides it
  // from the list; the current model is pinned (checkbox disabled) so you
  // can't end up in a "current model hidden" state.
  const toggleModelVisible = useCallback(async (providerId: string, modelId: string) => {
    const curSet = new Set(modelExcluded[providerId] || []);
    curSet.has(modelId) ? curSet.delete(modelId) : curSet.add(modelId);
    const newExcluded = [...curSet];
    setModelExcluded(prev => ({ ...prev, [providerId]: newExcluded }));
    try {
      await setCatalogExcluded(providerId, newExcluded);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [modelExcluded, showToast]);

  // Change one tier (haiku/sonnet/opus) mapping for a provider. Persists to
  // backend then re-switches the active claude provider so settings.json
  // regenerates with the new tier env vars.
  const changeTier = useCallback(async (providerId: string, tier: 'haiku' | 'sonnet' | 'opus', modelId: string) => {
    const cur = tierMaps[providerId] || {};
    const next = { ...cur, [tier]: modelId || undefined };
    // Clean up undefined keys.
    const cleaned: TierMap = {};
    if (next.haiku) cleaned.haiku = next.haiku;
    if (next.sonnet) cleaned.sonnet = next.sonnet;
    if (next.opus) cleaned.opus = next.opus;
    setTierMaps(prev => ({ ...prev, [providerId]: cleaned }));
    try {
      await setTierMap(providerId, cleaned);
      // Re-switch to regenerate settings.json with new tier env vars.
      if (activeAgentId === 'claude') {
        const adapter = adapters.find(a => a.id === 'claude');
        if (adapter?.current?.providerId === providerId && adapter.current.modelId) {
          await switchProvider('claude', providerId, adapter.current.modelId);
        }
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  }, [tierMaps, activeAgentId, adapters, showToast]);

  async function handleSwitch(agentId: string, providerId: string, modelId: string) {
    setSwitching(`${agentId}:${modelId}`);
    try {
      await switchProvider(agentId, providerId, modelId);
      showToast(t('agents.switchSuccess'), 'success');
      load();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSwitching(null);
    }
  }

  // Additive agents (workbuddy): toggling a site OFF removes the entries OKIT
  // wrote for it from the agent's own config. Switching between sites happens
  // inside the agent, so there is no fallback-to-official concept here.
  async function handleDisableSite(agentId: string, providerId: string) {
    setSwitching(`${agentId}:${providerId}`);
    try {
      await disableAgentProvider(agentId, providerId);
      showToast(t('home.siteDisabled'), 'success');
      load();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSwitching(null);
    }
  }

  if (loading) {
    return (
      <div className="quick-start-page" aria-busy="true">
        <div className="home-section">
          <div className="skeleton-line skeleton-line--title qs-skeleton-heading" />
          <div className="qs-skeleton-row">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="qs-skeleton-card">
                <div className="skeleton-line skeleton-line--short" />
                <div className="skeleton-line skeleton-line--title" />
              </div>
            ))}
          </div>
        </div>
        <div className="home-section">
          <div className="skeleton-line skeleton-line--title qs-skeleton-heading" />
          <div className="qs-skeleton-tabs">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-shape--pill" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="quick-start-page">
      {/* Goal ②: dashboard blocks — daily-driver content above the fold */}
      <UsageSummary />
      {/* Agent configuration section — tab + provider cards */}
      <section className="home-section home-section--agent">
        <div className="home-agent-heading">
          <h3 className="home-section-title">{t('home.agentConfig')}</h3>
          {activeAgent && (
            <div className="home-provider-actions">
              <button
                type="button"
                className="home-add-provider-btn"
                onClick={() => setShowAddPicker(true)}
                title={t('home.addProvider')}
              >
                <Plus size={15} />
              </button>
              <button
                type="button"
                className="home-view-config-btn"
                onClick={handleViewConfig}
                disabled={configLoading}
                title={configLoading ? t('common.loading') : t('home.viewConfig')}
              >
                <FileJson size={15} />
              </button>
            </div>
          )}
        </div>

      {/* Agent Tabs */}
      <div className="agent-tabs">
        {adapters.map((agent, i) => {
          const icon = getAgentIcon(agent.id);
          return (
            <button
              key={agent.id}
              className={`agent-tab${activeAgentId === agent.id ? ' active' : ''}${dragTabIndex === i ? ' dragging' : ''}${dropTabIndex === i && dragTabIndex !== null && dragTabIndex !== i ? ' drop-target' : ''}`}
              onClick={() => { setActiveAgentId(agent.id); setExpandedProvider(null); setShowAddPicker(false); setShowAllModels(new Set()); }}
              title={agent.name}
              draggable
              onDragStart={(e) => { setDragTabIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnter={() => { if (dragTabIndex !== null && dragTabIndex !== i) setDropTabIndex(i); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTabIndex(null); }}
              onDrop={(e) => { e.preventDefault(); handleDropTab(i); }}
              onDragEnd={() => { setDragTabIndex(null); setDropTabIndex(null); }}
            >
              {icon && <img src={icon} alt="" className={['agent-tab-icon', getAgentIconClass(agent.id)].filter(Boolean).join(' ')} draggable={false} />}
              {agent.current && <span className="agent-tab-dot" />}
            </button>
          );
        })}
      </div>

      {/* Provider cards */}
      {activeAgent && (
        <div className="agent-provider-rows">
          {activeAgent.compatibleProviders.map(p => {
            const isCurrent = activeAgent.current?.providerId === p.id;
            // Additive agents (zcode/workbuddy) keep many sites enabled at
            // once — the toggle reflects the real per-site config state
            // (backend), falling back to the current selection when unknown.
            const siteEnabled = activeAgent.additive
              ? (p.enabled !== undefined ? p.enabled : isCurrent)
              : isCurrent;
            const isExpanded = expandedProvider === p.id;
            // Provider-level excluded set — shared by model list and tier UI.
            const excludedSet = new Set(modelExcluded[p.id] || []);
            // Provider-level visible model list (recent + extraVisible, minus
            // excluded). Computed once so the model chips AND tier dropdowns
            // show the same set.
            const extraForP = extraVisible[p.id] || new Set<string>();
            const currentId = isCurrent ? activeAgent.current?.modelId : undefined;
            const visibleAfterExclude = p.models.filter(m =>
              (!excludedSet.has(m.id) || m.id === currentId) && (m.recent !== false || extraForP.has(m.id))
            );
            return (
              <div key={p.id} className={`provider-card provider-card--clickable${isCurrent ? ' provider-card--current' : ''}${isExpanded ? ' expanded' : ''}`}>
                <div
                  className="provider-card-header"
                  onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="provider-card-title">
                    {(() => { const icon = getProviderIcon(p.id); return icon ? <img src={icon} alt="" className={['provider-card-brand-icon', getProviderIconClass(p.id)].filter(Boolean).join(' ')} /> : null; })()}
                    <h3>{p.name}</h3>
                    {isCurrent && (
                      <span className="provider-card-current-tag">{t('agents.current')}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={siteEnabled}
                    className={`provider-switch${siteEnabled ? ' provider-switch--on' : ''}`}
                    title={siteEnabled ? (activeAgent.additive ? t('home.disableSite') : t('home.enabled')) : t('home.enable')}
                    disabled={(switching || '').startsWith(activeAgent.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!siteEnabled) {
                        // Switch ON — set this provider as current.
                        const m = p.models[0];
                        if (m) handleSwitch(activeAgent.id, p.id, m.id);
                      } else if (activeAgent.additive) {
                        // Switch OFF (additive) — remove this site's entries
                        // from the agent config. Switching happens inside the
                        // agent's own UI, so no official fallback is needed.
                        handleDisableSite(activeAgent.id, p.id);
                      } else {
                        // Switch OFF — for single-type agents, fall back to the
                        // official subscription. The provider stays in the home
                        // list but is no longer active.
                        const fallback = {
                          'claude': { providerId: 'anthropic-agent', modelId: 'claude-sonnet-4-6' },
                          'codex': { providerId: 'openai-codex', modelId: 'gpt-5.6-sol' },
                        }[activeAgent.id];
                        if (fallback) {
                          handleSwitch(activeAgent.id, fallback.providerId, fallback.modelId);
                        }
                      }
                    }}
                  >
                    <span className="provider-switch-knob" />
                  </button>
                  <button
                    type="button"
                    className="provider-card-remove-btn"
                    title={t('home.removeProvider')}
                    onClick={(e) => { e.stopPropagation(); handleRemoveHome(p.id); }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                {isExpanded && p.models.length > 0 && (
                  <div className="provider-card-models-list">
                    {(() => {
                      const showAll = showAllModels.has(p.id);
                      // Keep large provider model lists collapsed by default.
                      const COLLAPSED_LIMIT = 8;
                      const needsCollapse = visibleAfterExclude.length > COLLAPSED_LIMIT;
                      const visibleModels = !showAll && needsCollapse
                        ? visibleAfterExclude.slice(0, COLLAPSED_LIMIT)
                        : visibleAfterExclude;
                      const totalCount = p.models.length;
                      const visibleCount = visibleAfterExclude.length;
                      return (
                        <>
                          {visibleModels.map(m => {
                            const isThisModel = isCurrent && currentId === m.id;
                            const checked = !excludedSet.has(m.id);
                            const hideDisabled = isThisModel;
                            const switchingThis = switching === `${activeAgent.id}:${m.id}`;
                            return (
                              <div
                                key={m.id}
                                className={`agent-model-chip${isThisModel ? ' active' : ''}${switchingThis ? ' switching' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="agent-model-chip-name"
                                  disabled={switchingThis}
                                  onClick={() => handleSwitch(activeAgent.id, p.id, m.id)}
                                  title={isThisModel ? t('home.currentModel') : t('home.switchToModel')}
                                >
                                  <span className="agent-model-name">{m.name || m.id}</span>
                                </button>
                                {!hideDisabled && (
                                  <button
                                    type="button"
                                    className="agent-model-chip-remove"
                                    title={t('home.removeModel')}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const extra = extraVisible[p.id];
                                      if (extra && extra.has(m.id)) {
                                        // Was restored from hidden — just remove from extra.
                                        setExtraVisible(prev => {
                                          const cur = new Set(prev[p.id] || []);
                                          cur.delete(m.id);
                                          return { ...prev, [p.id]: cur };
                                        });
                                      } else {
                                        toggleModelVisible(p.id, m.id);
                                      }
                                    }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          {needsCollapse && (
                            <button
                              type="button"
                              className="agent-model-showall"
                              onClick={() => setShowAllModels(prev => {
                                const n = new Set(prev);
                                n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                                return n;
                              })}
                            >
                              {showAll ? t('home.collapse') : t('home.showAll')} ({visibleCount}/{totalCount})
                            </button>
                          )}
                          {excludedSet.size > 0 && (
                            <button
                              type="button"
                              className="agent-model-add-btn"
                              onClick={() => setAddModelPickerFor(p.id)}
                              title={t('home.addModels')}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                              {t('home.addModels')} ({excludedSet.size})
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                {/* Claude Code tier mapping — only for non-official providers.
                    Lets the user route haiku/sonnet/opus to different models on
                    the gateway so Claude Code's tier-switching doesn't 404. */}
                {isExpanded && activeAgentId === 'claude' && p.baseUrl !== 'https://api.anthropic.com' && p.models.length > 0 && (
                  <div className="provider-tier-maps">
                    {(['haiku', 'sonnet', 'opus'] as const).map(tier => {
                      const tierMap = tierMaps[p.id] || {};
                      const current = tierMap[tier] || '';
                      return (
                        <label key={tier} className="provider-tier-row">
                          <span className="provider-tier-label">{tier.toUpperCase()}</span>
                          <select
                            className="provider-tier-select"
                            value={current}
                            onChange={(e) => changeTier(p.id, tier, e.target.value)}
                          >
                            <option value="">{t('home.tierDefault')}</option>
                            {visibleAfterExclude.map(m => (
                              <option key={m.id} value={m.id}>{m.name || m.id}</option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {activeAgent.compatibleProviders.length === 0 && (
            <div className="home-empty-hint">{t('home.noProvidersHint')}</div>
          )}
        </div>
      )}
      {showAddPicker && activeAgent && (
        <div className="home-add-picker-overlay" onClick={() => setShowAddPicker(false)}>
          <div className="home-add-picker" onClick={e => e.stopPropagation()}>
            <div className="home-add-picker-header">
              <h3>{t('home.addProviderTitle', { name: activeAgent.name })}</h3>
              <button type="button" className="btn-icon" onClick={() => setShowAddPicker(false)}>✕</button>
            </div>
            <div className="home-add-picker-list">
              {(activeAgent.availableProviders || []).map(p => (
                <label key={p.id} className={`home-add-picker-item${p.added ? ' added' : ''}`}>
                  <input
                    type="checkbox"
                    checked={p.added}
                    onChange={() => p.added ? handleRemoveHome(p.id) : handleAddHome(p.id)}
                  />
                  {(() => { const icon = getProviderIcon(p.id); return icon ? <img src={icon} alt="" className={['provider-card-brand-icon', getProviderIconClass(p.id)].filter(Boolean).join(' ')} /> : null; })()}
                  <span>{p.name}</span>
                </label>
              ))}
              {(!activeAgent.availableProviders || activeAgent.availableProviders.length === 0) && (
                <p className="home-empty-hint">{t('home.noAvailableProviders')}</p>
              )}
            </div>
          </div>
        </div>
      )}
      {addModelPickerFor && activeAgent && (() => {
        const provider = activeAgent.compatibleProviders.find(p => p.id === addModelPickerFor);
        if (!provider) return null;
        // The picker shows models that are NOT currently visible — both
        // auto-hidden (recent=false) and manually removed (in excludedSet).
        const excludedSet = new Set(modelExcluded[addModelPickerFor] || []);
        const visibleIds = new Set(provider.models.filter(m => m.recent !== false && !excludedSet.has(m.id)).map(m => m.id));
        const hiddenModels = provider.models.filter(m => !visibleIds.has(m.id));
        return (
          <div className="home-add-picker-overlay" onClick={() => setAddModelPickerFor(null)}>
            <div className="home-add-picker" onClick={e => e.stopPropagation()}>
              <div className="home-add-picker-header">
                <h3>{t('home.addModelsTitle', { name: provider.name })}</h3>
                <button type="button" className="btn-icon" onClick={() => setAddModelPickerFor(null)}>✕</button>
              </div>
              <div className="home-add-picker-list">
                {hiddenModels.length === 0 && (
                  <p className="home-empty-hint">{t('home.noHiddenModels')}</p>
                )}
                {hiddenModels.map(m => (
                  <label key={m.id} className="home-add-picker-item">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => {
                        if (m.recent === false) {
                          // Auto-hidden by recent filter — add to extraVisible.
                          setExtraVisible(prev => {
                            const cur = new Set(prev[addModelPickerFor] || []);
                            cur.add(m.id);
                            return { ...prev, [addModelPickerFor]: cur };
                          });
                        } else {
                          // Manually excluded — remove from excludedSet.
                          toggleModelVisible(addModelPickerFor, m.id);
                        }
                      }}
                    />
                    <span>{m.name || m.id}</span>
                    {m.id !== (m.name || m.id) && (
                      <span style={{ color: 'var(--ink-muted)', fontSize: 11 }}>· {m.id}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      {configFiles !== null && (
        <div className="home-add-picker-overlay" onClick={() => setConfigFiles(null)}>
          <div className="home-config-viewer" onClick={e => e.stopPropagation()}>
            <div className="home-add-picker-header">
              <h3>{t('home.configFilesTitle')}</h3>
              <div className="home-config-viewer-actions">
                <button type="button" className="home-config-refresh-btn" onClick={handleViewConfig} disabled={configLoading} title={t('home.refresh')}>
                  <RefreshCw size={14} />
                </button>
                <button type="button" className="btn-icon" onClick={() => setConfigFiles(null)} title={t('common.close')}><X size={14} /></button>
              </div>
            </div>
            {/* Tab bar — only shown when there's more than one file. Each
                tab is labeled by the file's basename so long paths don't
                overflow; the full path is shown above the content. */}
            {configFiles.length > 1 && (
              <div className="home-config-tabs">
                {configFiles.map((f, i) => {
                  const basename = f.path.split('/').pop() || f.path;
                  return (
                    <button
                      key={f.path}
                      type="button"
                      className={`home-config-tab${i === activeConfigTab ? ' active' : ''}`}
                      onClick={() => setActiveConfigTab(i)}
                      title={f.path}
                    >
                      {basename}
                      <span className={`home-config-tab-dot${f.exists ? ' exists' : ' missing'}`} />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="home-config-viewer-body">
              {configFiles.length > 0 && (() => {
                const f = configFiles[Math.min(activeConfigTab, configFiles.length - 1)];
                const draft = configDrafts[f.path];
                const original = f.content ?? '';
                const current = draft !== undefined ? draft : original;
                const dirty = draft !== undefined && draft !== original;
                return (
                  <div className="home-config-file">
                    <div className="home-config-file-path">
                      <code>{f.path}</code>
                      {dirty && <span className="home-config-dirty-dot" title={t('home.unsavedChanges')} />}
                      <button
                        type="button"
                        className={`home-config-preview-btn${configViewMode === 'tree' ? ' active' : ''}`}
                        disabled={!f.exists}
                        onClick={() => setConfigViewMode(prev => prev === 'tree' ? 'raw' : 'tree')}
                        title={t('home.configPreview')}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        className="home-config-copy-btn"
                        disabled={!f.exists}
                        onClick={() => handleCopyConfig(f.path)}
                        title={t('home.configCopy')}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        className={`home-config-save-btn${dirty ? ' dirty' : ''}${configSaveState === 'ok' ? ' saved' : ''}${configSaveState === 'fail' ? ' failed' : ''}`}
                        disabled={!f.exists || (!dirty && configSaveState === 'idle') || configSaveState === 'saving'}
                        onClick={() => handleSaveConfig(f.path)}
                        title={t('home.save')}
                      >
                        {configSaveState === 'saving' ? <Loader2 size={14} className="home-config-save-spin" /> : configSaveState === 'ok' ? <Check size={14} /> : configSaveState === 'fail' ? <X size={14} /> : <Save size={14} />}
                      </button>
                    </div>
                    {f.exists ? (
                      configViewMode === 'tree' ? (
                        <JsonTreeView value={current} fileName={f.path} />
                      ) : (
                        <textarea
                          className="home-config-file-editor"
                          value={current}
                          spellCheck={false}
                          onChange={(e) => setConfigDrafts(prev => ({ ...prev, [f.path]: e.target.value }))}
                        />
                      )
                    ) : (
                      <p className="home-empty-hint">{t('home.fileMissing')}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      </section>
    </div>
  );
}
