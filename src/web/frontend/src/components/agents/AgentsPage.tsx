import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAdapters, launchAgent, switchProvider, AgentInfo } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function AgentsPage() {
  const { toast } = useApp() as any;
  const { t, providerName } = useI18n();
  const [adapters, setAdapters] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [pickerAgent, setPickerAgent] = useState<AgentInfo | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getAdapters();
      setAdapters(data.adapters || []);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const configured = adapters.filter(adapter => adapter.current).length;
    const compatible = adapters.reduce((sum, adapter) => sum + adapter.compatibleProviders.length, 0);
    const types = new Set(adapters.flatMap(adapter => adapter.supportedTypes));
    return { configured, compatible, types: types.size };
  }, [adapters]);

  async function handleSwitch(agentId: string, providerId: string, modelId: string) {
    setSwitching(agentId);
    try {
      await switchProvider(agentId, providerId, modelId);
      toast(t('agents.switchSuccess'), 'success');
      setPickerAgent(null);
      load();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSwitching(null);
    }
  }

  async function handleLaunch(agent: AgentInfo) {
    setLaunching(agent.id);
    try {
      await launchAgent(agent.id);
      toast(t('agents.launchSuccess'), 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLaunching(null);
    }
  }

  if (loading) return <div className="page-loading">{t('common.loading')}</div>;

  return (
    <div className="access-workspace agents-workspace">
      <header className="access-hero">
        <div className="access-hero-copy">
          <h1>{t('agents.title')}</h1>
          <p>{t('agents.lede')}</p>
        </div>
        <div className="access-hero-stats" aria-label="Agent routing summary">
          <div><span>{t('agents.totalAgents')}</span><strong>{adapters.length}</strong></div>
          <div><span>{t('agents.configured')}</span><strong>{stats.configured}</strong></div>
          <div><span>{t('agents.compatibleRoutes')}</span><strong>{stats.compatible}</strong></div>
          <div><span>{t('agents.modelTypes')}</span><strong>{stats.types}</strong></div>
        </div>
      </header>

      <div className="agents-list">
        {adapters.map(adapter => (
          <article key={adapter.id} className="agent-card">
            <div className="agent-card-header">
              <div className="agent-card-title">
                <h3>{adapter.name}</h3>
                <div className="agent-card-types">
                  {adapter.supportedTypes.map(t => (
                    <span key={t} className={`type-badge type-badge--${t}`}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="agent-card-actions">
                <button
                  className="vault-toolbar-btn"
                  onClick={() => setPickerAgent(adapter)}
                >
                  {adapter.current ? t('agents.switchModel') : t('agents.selectModel')}
                </button>
                {adapter.canLaunch && (
                  <button
                    className="vault-toolbar-btn vault-toolbar-btn--secondary"
                    disabled={launching === adapter.id || adapter.installed === false}
                    title={adapter.installed === false ? t('agents.launchNotInstalled') : t('agents.launchTerminal')}
                    onClick={() => handleLaunch(adapter)}
                  >
                    {launching === adapter.id ? t('common.loading') : t('agents.launchTerminal')}
                  </button>
                )}
              </div>
            </div>

            <div className="agent-card-current">
              {adapter.current ? (
                <div className="agent-current-row">
                  <span className="auth-dot auth-dot--active" />
                  <span className="agent-current-active">
                    <strong>{adapter.current.providerName}</strong>
                    <span className="agent-current-sep">/</span>
                    {adapter.current.modelId}
                  </span>
                </div>
              ) : (
                <span className="agent-current-none">{t('common.notConfigured')}</span>
              )}
            </div>
          </article>
        ))}
      </div>

      {pickerAgent && (
        <ModelPicker
          agent={pickerAgent}
          switching={switching}
          onSwitch={handleSwitch}
          onClose={() => setPickerAgent(null)}
        />
      )}
    </div>
  );
}

function ModelPicker({ agent, switching, onSwitch, onClose }: {
  agent: AgentInfo;
  switching: string | null;
  onSwitch: (agentId: string, providerId: string, modelId: string) => void;
  onClose: () => void;
}) {
  const { t, providerName } = useI18n();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const providers = agent.compatibleProviders;
  const activeProvider = selectedProvider
    ? providers.find(p => p.id === selectedProvider)
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="picker-panel" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <h2>{agent.name} — {t('agents.selectModel')}</h2>
          <button className="progress-close" onClick={onClose}>×</button>
        </div>

        <div className="picker-body">
          <div className="picker-sidebar">
            <div className="picker-sidebar-label">{t('agents.platform')}</div>
            {providers.length === 0 && (
              <div className="picker-empty">{t('agents.noCompatible')}</div>
            )}
            {providers.map(p => (
              <div
                key={p.id}
                className={`picker-provider${selectedProvider === p.id ? ' active' : ''}${agent.current?.providerId === p.id ? ' is-current' : ''}`}
                onClick={() => setSelectedProvider(p.id)}
              >
                <span className="picker-provider-name">{providerName(p.id, p.name)}</span>
              </div>
            ))}
          </div>

          <div className="picker-content">
            {!activeProvider ? (
              <div className="picker-placeholder">{t('agents.selectLeft')}</div>
            ) : (
              <>
                <div className="picker-content-header">
                  <span className="picker-content-name">{activeProvider.name}</span>
                  <span className="picker-content-url">{t('agents.platformsAvailable', { n: providers.length })}</span>
                </div>
                <div className="picker-model-list">
                  {activeProvider.models.map(m => {
                    const isCurrent = agent.current?.providerId === activeProvider.id
                      && agent.current?.modelId === m.id;
                    return (
                      <button
                        key={m.id}
                        className={`picker-model-btn${isCurrent ? ' picker-model-btn--active' : ''}`}
                        disabled={switching === agent.id}
                        onClick={() => onSwitch(agent.id, activeProvider.id, m.id)}
                      >
                        <span className="picker-model-name">{m.name || m.id}</span>
                        {m.id !== (m.name || m.id) && (
                          <span className="picker-model-id">{m.id}</span>
                        )}
                        {isCurrent && <span className="picker-model-current">{t('agents.current')}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
