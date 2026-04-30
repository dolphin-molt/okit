import { useState, useEffect, useCallback, useMemo } from 'react';
import { listProviders, deleteProvider, createProvider, updateProvider, getAuthStatus, triggerOAuthLogin, fetchModels, Provider, ProviderModel, ProviderEndpoint } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import PageSidebar from '../shared/PageSidebar';
import VaultPickerModal from '../shared/VaultPickerModal';
import CustomSelect from '../shared/CustomSelect';

const SHOW_MODELS = 3;

interface AuthState {
  hasApiKey: boolean;
  oauthLoggedIn: boolean | null;
  authMode: string;
}

export default function ModelsPage() {
  const { showToast: toast, confirm } = useApp() as any;
  const { t, providerName } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [authMap, setAuthMap] = useState<Record<string, AuthState>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProvider, setEditProvider] = useState<Provider | null>(null);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [testingConn, setTestingConn] = useState<string | null>(null);
  const [endpointResults, setEndpointResults] = useState<Record<string, { success: boolean; message: string }[]>>({});
  const [syncingModels, setSyncingModels] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [data, authData] = await Promise.all([listProviders(), getAuthStatus()]);
      setProviders(data.providers || []);
      const map: Record<string, AuthState> = {};
      for (const s of authData.statuses || []) {
        map[s.id] = { hasApiKey: s.hasApiKey, oauthLoggedIn: s.oauthLoggedIn, authMode: s.authMode };
      }
      setAuthMap(map);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(p: Provider) {
    const ok = await confirm(t('models.confirmDelete', { name: p.name }));
    if (!ok) return;
    try {
      await deleteProvider(p.id);
      toast(t('models.deleted', { name: p.name }), 'success');
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function handleOAuthLogin(providerId: string) {
    setLoggingIn(providerId);
    try {
      const res = await triggerOAuthLogin(providerId);
      toast(res.message, 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoggingIn(null);
    }
  }

  async function handleTestConnection(p: Provider) {
    const eps = p.endpoints || [{ type: p.type, baseUrl: p.baseUrl }];
    setTestingConn(p.id);
    setEndpointResults(prev => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    const results: { success: boolean; message: string }[] = [];
    const { api } = await import('../../api/client');
    for (const ep of eps) {
      try {
        const res = await api('/api/vault/test-key', {
          method: 'POST',
          body: JSON.stringify({ baseUrl: ep.baseUrl, type: ep.type, vaultKey: p.vaultKey }),
        }) as any;
        results.push({ success: res.success, message: res.message });
      } catch (err: any) {
        results.push({ success: false, message: err.message || t('models.testFailed') });
      }
      setEndpointResults(prev => ({ ...prev, [p.id]: [...results] }));
    }
    const allOk = results.every(r => r.success);
    toast(
      allOk ? t('models.allEndpointsOk') : t('models.endpointsFailed', { n: results.filter(r => !r.success).length }),
      allOk ? 'success' : 'error'
    );
    setTestingConn(null);
  }

  async function handleSyncModels(p: Provider) {
    setSyncingModels(p.id);
    try {
      const res = await fetchModels(p.id);
      if (res.success) {
        toast(t('models.synced', { n: res.models.length }), 'success');
        load();
      } else if (res.kept) {
        toast(t('models.syncKept', { n: res.kept.length }), 'info');
      } else {
        toast(t('models.syncFailed'), 'error');
      }
    } catch (err: any) {
      toast(err.message || t('models.syncFailed'), 'error');
    } finally {
      setSyncingModels(null);
    }
  }

  function handleEdit(p: Provider) {
    setEditProvider(p);
    setShowForm(true);
  }

  function handleAdd() {
    setEditProvider(null);
    setShowForm(true);
  }

  async function handleFormSave(data: any) {
    try {
      if (editProvider) {
        await updateProvider(editProvider.id, data);
        toast(t('models.updated', { name: data.name }), 'success');
      } else {
        await createProvider(data);
        toast(t('models.added', { name: data.name }), 'success');
      }
      setShowForm(false);
      setEditProvider(null);
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  function toggleExpand(id: string) {
    setExpandedModels(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const filtered = activeProvider
    ? providers.filter(p => p.id === activeProvider)
    : [...providers].sort((a, b) => a.id.localeCompare(b.id));

  const modelStats = useMemo(() => {
    const endpoints = providers.reduce((sum, p) => sum + (p.endpoints?.length || 1), 0);
    const models = providers.reduce((sum, p) => sum + (p.models?.length || 0), 0);
    const authed = providers.filter(p => {
      const auth = authMap[p.id];
      return Boolean(p.vaultKey && auth?.hasApiKey) || auth?.oauthLoggedIn === true;
    }).length;
    return { endpoints, models, authed };
  }, [providers, authMap]);

  if (loading) return <div className="page-loading">{t('common.loading')}</div>;

  return (
    <div className="page-with-sidebar">
      <PageSidebar sections={[
        {
          title: t('models.platformList'),
          items: [
            { key: '__all__', label: t('models.allPlatforms'), count: providers.length, active: !activeProvider, onClick: () => setActiveProvider(null) },
            ...[...providers].sort((a, b) => a.id.localeCompare(b.id)).map(p => ({
              key: p.id,
              label: providerName(p.id, p.name),
              count: p.models?.length || 0,
              active: activeProvider === p.id,
              onClick: () => setActiveProvider(p.id),
            })),
          ],
        },
      ]} />

      <div className="page-sidebar-main access-workspace models-workspace">
        <header className="access-hero">
          <div className="access-hero-copy">
            <h1>{t('models.title')}</h1>
            <p>{t('models.lede')}</p>
          </div>
          <div className="access-hero-stats" aria-label="Model provider summary">
            <div><span>{t('models.totalPlatforms')}</span><strong>{providers.length}</strong></div>
            <div><span>{t('models.totalModels')}</span><strong>{modelStats.models}</strong></div>
            <div><span>{t('models.totalEndpoints')}</span><strong>{modelStats.endpoints}</strong></div>
            <div><span>{t('models.authReady')}</span><strong>{modelStats.authed}</strong></div>
          </div>
        </header>

        <div className="access-command-bar">
          <div>
            <span>{activeProvider ? t('models.filteredPlatform') : t('models.allPlatforms')}</span>
            <strong>{filtered.length}</strong>
          </div>
          <button className="vault-toolbar-btn" onClick={handleAdd}>{t('models.addPlatform')}</button>
        </div>

        {filtered.length === 0 && (
          <div className="empty-state"><p>{t('models.noMatch')}</p></div>
        )}

        <div className="provider-list">
          {filtered.map(p => {
            const eps = p.endpoints || [{ type: p.type, baseUrl: p.baseUrl }];
            const showAll = expandedModels.has(p.id);
            const visibleModels = showAll ? p.models : p.models.slice(0, SHOW_MODELS);
            const hasMore = p.models.length > SHOW_MODELS;

            return (
              <article key={p.id} className="provider-card">
                <div className="provider-card-header">
                  <div className="provider-card-title">
                    <h3>{providerName(p.id, p.name)}</h3>
                  </div>
                  <div className="provider-card-actions">
                    <button className="btn-icon" onClick={() => handleSyncModels(p)} title={t('models.syncModels')} disabled={syncingModels === p.id}>
                      {syncingModels === p.id ? '...' : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      )}
                    </button>
                    <button className="btn-icon btn-icon--test" onClick={() => handleTestConnection(p)} title={t('models.testConn')} disabled={testingConn === p.id}>
                      {testingConn === p.id ? '...' : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      )}
                    </button>
                    <button className="btn-icon" onClick={() => handleEdit(p)} title={t('common.edit')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="btn-icon btn-icon--danger" onClick={() => handleDelete(p)} title={t('common.delete')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>

                <div className="provider-card-meta">
                  {eps.map((ep, i) => {
                    const epResult = endpointResults[p.id]?.[i];
                    return (
                      <div key={i} className="provider-meta-row">
                        <span className="provider-meta-label">{eps.length > 1 ? t('models.endpointN', { n: i + 1 }) : t('models.endpoint')}</span>
                        <span className="provider-meta-value">
                          <span className="endpoint-type-badge">{ep.type}</span>
                          <span className="provider-meta-url">{ep.baseUrl}</span>
                          {testingConn === p.id && !epResult && i === (endpointResults[p.id]?.length || 0) && (
                            <span className="ep-test-spinner">...</span>
                          )}
                          {epResult && (
                            <span className={`ep-test-result${epResult.success ? ' ep-test-ok' : ' ep-test-fail'}`}>
                              {epResult.success ? '✓' : '✗'}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  <div className="provider-meta-row">
                    <span className="provider-meta-label">{t('models.auth')}</span>
                    <span className="provider-meta-value">
                      {(() => {
                        const auth = authMap[p.id];
                        const hasOAuth = p.authMode === 'oauth' || p.authMode === 'both';
                        const oauthOk = auth?.oauthLoggedIn === true;
                        const apiOk = auth?.hasApiKey;
                        return (
                          <span className="auth-status-group">
                            {p.vaultKey && (
                              <span className={`auth-indicator${apiOk ? ' auth-indicator--key' : ' auth-indicator--none'}`}>
                                <span className="auth-dot" /> {p.vaultKey}
                              </span>
                            )}
                            {hasOAuth && (
                              <span className={`auth-indicator${oauthOk ? ' auth-indicator--oauth' : ' auth-indicator--none'}`}>
                                <span className="auth-dot" /> OAuth{oauthOk ? ` ${t('models.loggedIn')}` : ` ${t('models.notLoggedIn')}`}
                              </span>
                            )}
                            {!p.vaultKey && !hasOAuth && (
                              <span className="auth-indicator auth-indicator--none"><span className="auth-dot" /> {t('common.notConfigured')}</span>
                            )}
                            {hasOAuth && !oauthOk && (
                              <button
                                className="auth-login-btn"
                                disabled={loggingIn === p.id}
                                onClick={() => handleOAuthLogin(p.id)}
                              >
                                {loggingIn === p.id ? '...' : t('models.login')}
                              </button>
                            )}
                          </span>
                        );
                      })()}
                    </span>
                  </div>
                </div>

                {p.models.length > 0 && (
                  <div className="provider-card-models">
                    <div className="provider-models-label">{t('models.modelsCount', { n: p.models.length })}</div>
                    <div className="provider-models-list">
                      {visibleModels.map(m => (
                        <div key={m.id} className="model-item">
                          <span className="model-item-name">{m.name || m.id}</span>
                          {m.id !== (m.name || m.id) && (
                            <span className="model-item-id">{m.id}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {hasMore && (
                      <button className="models-expand-btn" onClick={() => toggleExpand(p.id)}>
                        {showAll ? t('models.collapse') : t('models.expandAll', { n: p.models.length })}
                      </button>
                    )}
                  </div>
                )}

                {p.usedBy && p.usedBy.length > 0 && (
                  <div className="provider-card-usage">
                    {p.usedBy.map(u => (
                      <span key={u.id} className="provider-usage-tag">{u.name} → {u.modelId}</span>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      {showForm && (
        <ProviderForm
          provider={editProvider}
          onSave={handleFormSave}
          onClose={() => { setShowForm(false); setEditProvider(null); }}
        />
      )}
    </div>
  );
}

/* --- Provider Form Modal --- */
function ProviderForm({ provider, onSave, onClose }: {
  provider: Provider | null;
  onSave: (data: any) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(provider?.name || '');
  const [endpoints, setEndpoints] = useState<ProviderEndpoint[]>(
    provider?.endpoints || (provider ? [{ type: provider.type, baseUrl: provider.baseUrl }] : [{ type: 'openai', baseUrl: '' }])
  );
  const [models, setModels] = useState<ProviderModel[]>(
    provider?.models?.map(m => ({ ...m })) || [{ id: '', name: '' }]
  );
  const [vaultKey, setVaultKey] = useState(provider?.vaultKey || '');
  const [showVaultPicker, setShowVaultPicker] = useState(false);

  function addEndpoint() {
    setEndpoints([...endpoints, { type: 'openai', baseUrl: '' }]);
  }

  function removeEndpoint(i: number) {
    if (endpoints.length <= 1) return;
    setEndpoints(endpoints.filter((_, idx) => idx !== i));
  }

  function updateEndpoint(i: number, field: keyof ProviderEndpoint, value: string) {
    const next = [...endpoints];
    next[i] = { ...next[i], [field]: value };
    setEndpoints(next);
  }

  function addModel() {
    setModels([...models, { id: '', name: '' }]);
  }

  function removeModel(i: number) {
    setModels(models.filter((_, idx) => idx !== i));
  }

  function updateModel(i: number, field: keyof ProviderModel, value: string) {
    const next = [...models];
    next[i] = { ...next[i], [field]: value || undefined };
    setModels(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validModels = models.filter(m => m.id.trim());
    const primary = endpoints[0];

    onSave({
      id: provider?.id || name.toLowerCase().replace(/\s+/g, '-'),
      name,
      type: primary.type,
      baseUrl: primary.baseUrl,
      endpoints: endpoints.filter(ep => ep.baseUrl.trim()),
      models: validModels,
      vaultKey: vaultKey.trim() || undefined,
      authMode: vaultKey.trim() ? 'api_key' : 'none',
    });
  }

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel--wide provider-form-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel-header">
          <h2>{provider ? t('models.editPlatform') : t('models.newPlatform')}</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-panel-body provider-form-body">
            <div className="form-group">
              <label>{t('common.name')}</label>
              <input className="vault-input" value={name} onChange={e => setName(e.target.value)} required disabled={!!provider} />
            </div>

            <div className="form-group">
              <label>{t('models.apiEndpoint')}</label>
              <div className="endpoint-list">
                {endpoints.map((ep, i) => (
                  <div key={i} className="endpoint-row">
                    <CustomSelect
                      className="endpoint-type-select"
                      value={ep.type}
                      onChange={v => updateEndpoint(i, 'type', v)}
                      options={[
                        { value: 'anthropic', label: 'anthropic' },
                        { value: 'openai', label: 'openai' },
                        { value: 'google', label: 'google' },
                      ]}
                    />
                    <input className="vault-input endpoint-url-input" value={ep.baseUrl} onChange={e => updateEndpoint(i, 'baseUrl', e.target.value)} placeholder="https://api.example.com" required />
                    {endpoints.length > 1 && (
                      <button type="button" className="endpoint-remove-btn" onClick={() => removeEndpoint(i)}>×</button>
                    )}
                  </div>
                ))}
                <button type="button" className="model-add-btn" onClick={addEndpoint}>{t('models.addEndpoint')}</button>
              </div>
            </div>

            <div className="form-group">
              <label>API Key</label>
              <div className="vault-ref-field">
                {vaultKey ? (
                  <div className="vault-ref-selected">
                    <span className="vault-ref-key">{vaultKey}</span>
                    <button type="button" className="vault-ref-clear" onClick={() => setVaultKey('')}>×</button>
                    <button type="button" className="vault-ref-change" onClick={() => setShowVaultPicker(true)}>{t('common.replace')}</button>
                  </div>
                ) : (
                  <button type="button" className="vault-ref-trigger" onClick={() => setShowVaultPicker(true)}>{t('models.selectFromVault')}</button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>{t('models.models')}</label>
              <div className="model-form-list">
                {models.map((m, i) => (
                  <div key={i} className="model-form-row">
                    <input className="vault-input model-form-id" value={m.id} onChange={e => updateModel(i, 'id', e.target.value)} placeholder={t('models.modelId')} />
                    <input className="vault-input model-form-name" value={m.name || ''} onChange={e => updateModel(i, 'name', e.target.value)} placeholder={t('models.displayName')} />
                    <button type="button" className="endpoint-remove-btn" onClick={() => removeModel(i)}>×</button>
                  </div>
                ))}
                <button type="button" className="model-add-btn" onClick={addModel}>{t('models.addModel')}</button>
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn-save">{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>

    {showVaultPicker && (
      <VaultPickerModal
        selected={vaultKey}
        onSelect={key => { setVaultKey(key); setShowVaultPicker(false); }}
        onClose={() => setShowVaultPicker(false)}
        testEndpoint={endpoints[0]?.baseUrl ? { baseUrl: endpoints[0].baseUrl, type: endpoints[0].type } : undefined}
      />
    )}
    </>
  );
}
