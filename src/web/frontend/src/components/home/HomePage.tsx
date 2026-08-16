import { useEffect, useState, useCallback } from 'react';
import { getAdapters, switchProvider, addHomeProvider, removeHomeProvider, getAgentConfigFiles, saveAgentConfigFile, getCatalogExcluded, setCatalogExcluded, getTierMaps, setTierMap, AgentInfo, AgentConfigFile, TierMap } from '../../api/providers';
import { useI18n } from '../../i18n';
import { useApp } from '../Layout/AppContext';
import { getAgentIcon } from '../../assets/agents';
import { getProviderIcon } from '../../assets/providers';
import UsageSummary from './UsageSummary';

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
  const [configSaving, setConfigSaving] = useState(false);
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

  const load = useCallback(async () => {
    try {
      const data = await getAdapters();
      const list = data.adapters || [];
      setAdapters(list);
      // Only seed the active agent on the very first load. Use the functional
      // form so we read the latest activeAgentId — otherwise the closure would
      // capture the initial null forever and reset the tab to list[0] on every
      // reload (e.g. after a switch), yanking the user back to Claude.
      setActiveAgentId(prev => (prev == null && list.length > 0 ? list[0].id : prev));
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

  const handleViewConfig = useCallback(async () => {
    if (!activeAgentId) return;
    setConfigLoading(true);
    setConfigFiles([]);
    setActiveConfigTab(0);
    setConfigDrafts({});
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
    setConfigSaving(true);
    try {
      const content = configDrafts[filePath];
      if (content === undefined) return;
      await saveAgentConfigFile(activeAgentId, filePath, content);
      // Commit the draft as the new "original" so the file is no longer dirty.
      setConfigFiles(prev => prev ? prev.map(f => f.path === filePath ? { ...f, content } : f) : prev);
      setConfigDrafts(prev => { const n = { ...prev }; delete n[filePath]; return n; });
      showToast(t('home.configSaved'), 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setConfigSaving(false);
    }
  }, [activeAgentId, configDrafts, showToast, t]);

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

  if (loading) return <div className="quick-start-page"><p style={{ padding: 40 }}>{t('common.loading')}</p></div>;

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
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                {t('home.addProvider')}
              </button>
              <button
                type="button"
                className="home-view-config-btn"
                onClick={handleViewConfig}
                disabled={configLoading}
              >
                {configLoading ? t('common.loading') : t('home.viewConfig')}
              </button>
            </div>
          )}
        </div>

      {/* Agent Tabs */}
      <div className="agent-tabs">
        {adapters.map(agent => {
          const icon = getAgentIcon(agent.id);
          return (
            <button
              key={agent.id}
              className={`agent-tab${activeAgentId === agent.id ? ' active' : ''}`}
              onClick={() => { setActiveAgentId(agent.id); setExpandedProvider(null); setShowAddPicker(false); setShowAllModels(new Set()); }}
              title={agent.name}
            >
              {icon && <img src={icon} alt="" className="agent-tab-icon" />}
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
                    {(() => { const icon = getProviderIcon(p.id); return icon ? <img src={icon} alt="" className="provider-card-brand-icon" /> : null; })()}
                    <h3>{p.name}</h3>
                    {isCurrent && (
                      <span className="provider-card-current-tag">{t('agents.current')}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isCurrent}
                    className={`provider-switch${isCurrent ? ' provider-switch--on' : ''}`}
                    title={isCurrent ? t('home.enabled') : t('home.enable')}
                    disabled={(switching || '').startsWith(activeAgent.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isCurrent) {
                        // Switch ON — set this provider as current.
                        const m = p.models[0];
                        if (m) handleSwitch(activeAgent.id, p.id, m.id);
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
                  {(() => { const icon = getProviderIcon(p.id); return icon ? <img src={icon} alt="" className="provider-card-brand-icon" /> : null; })()}
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
              <h3>{t('home.configFilesTitle', { name: activeAgent?.name || '' })}</h3>
              <div className="home-config-viewer-actions">
                <button type="button" className="home-view-config-btn" onClick={handleViewConfig} disabled={configLoading}>
                  {t('home.refresh')}
                </button>
                <button type="button" className="btn-icon" onClick={() => setConfigFiles(null)}>✕</button>
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
                  <div key={f.path} className="home-config-file">
                    <div className="home-config-file-path">
                      <code>{f.path}</code>
                      {dirty && <span className="home-config-dirty-dot" title={t('home.unsavedChanges')} />}
                      <button
                        type="button"
                        className={`home-config-save-btn${dirty ? ' dirty' : ''}`}
                        disabled={!f.exists || !dirty || configSaving}
                        onClick={() => handleSaveConfig(f.path)}
                      >
                        {configSaving ? t('common.loading') : t('home.save')}
                      </button>
                    </div>
                    {f.exists ? (
                      <textarea
                        className="home-config-file-editor"
                        value={current}
                        spellCheck={false}
                        onChange={(e) => setConfigDrafts(prev => ({ ...prev, [f.path]: e.target.value }))}
                      />
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
