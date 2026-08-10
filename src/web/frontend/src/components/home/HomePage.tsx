import { useEffect, useState, useCallback } from 'react';
import { getAdapters, launchAgent, switchProvider, AgentInfo } from '../../api/providers';
import { useI18n } from '../../i18n';
import { useApp } from '../Layout/AppContext';
import { getAgentIcon } from '../../assets/agents';

export default function HomePage() {
  const { t } = useI18n();
  const { showToast } = useApp();
  const [adapters, setAdapters] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getAdapters();
      const list = data.adapters || [];
      setAdapters(list);
      if (!activeAgentId && list.length > 0) {
        setActiveAgentId(list[0].id);
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const activeAgent = adapters.find(a => a.id === activeAgentId) || null;

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

  async function handleLaunch(agent: AgentInfo) {
    setLaunching(agent.id);
    try {
      await launchAgent(agent.id);
      showToast(t('agents.launchSuccess'), 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLaunching(null);
    }
  }

  if (loading) return <div className="quick-start-page"><p style={{ padding: 40 }}>{t('common.loading')}</p></div>;

  return (
    <div className="quick-start-page">
      {/* Agent Tabs */}
      <div className="agent-tabs">
        {adapters.map(agent => {
          const icon = getAgentIcon(agent.id);
          return (
            <button
              key={agent.id}
              className={`agent-tab${activeAgentId === agent.id ? ' active' : ''}`}
              onClick={() => { setActiveAgentId(agent.id); setExpandedProvider(null); }}
              title={agent.name}
            >
              {icon && <img src={icon} alt="" className="agent-tab-icon" />}
              {agent.current && <span className="agent-tab-dot" />}
            </button>
          );
        })}
      </div>

      {/* Agent header + launch button */}
      {activeAgent && (
        <div className="agent-detail-header">
          <div className="agent-detail-title">
            {getAgentIcon(activeAgent.id) && (
              <img src={getAgentIcon(activeAgent.id)} alt="" className="agent-detail-icon" />
            )}
            <div>
                <h2>{activeAgent.name}</h2>
              </div>
          </div>
          <div className="agent-detail-actions">
            {activeAgent.canLaunch && (
              <button
                className="agent-detail-btn agent-detail-btn--secondary"
                title={activeAgent.launchType === 'app' ? t('agents.launchApp') : t('agents.launchTerminal')}
                disabled={launching === activeAgent.id || activeAgent.installed === false}
                onClick={() => handleLaunch(activeAgent)}
              >
                {launching === activeAgent.id ? <span className="agent-icon-loading" /> : (
                  activeAgent.launchType === 'app' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  )
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Provider cards */}
      {activeAgent && (
        <div className="agent-provider-rows">
          {activeAgent.compatibleProviders.map(p => {
            const isCurrent = activeAgent.current?.providerId === p.id;
            const isExpanded = expandedProvider === p.id;
            return (
              <div key={p.id} className={`provider-card provider-card--clickable${isCurrent ? ' provider-card--current' : ''}${isExpanded ? ' expanded' : ''}`}>
                <div
                  className="provider-card-header"
                  onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="provider-card-title">
                    <h3>{p.name}</h3>
                    {isCurrent && (
                      <span className="provider-card-current-tag">{t('agents.current')}</span>
                    )}
                  </div>
                  <span className="provider-card-model-count">{p.models.length}</span>
                </div>
                {isExpanded && p.models.length > 0 && (
                  <div className="provider-card-models-list">
                    {p.models.map(m => {
                      const isThisModel = isCurrent && activeAgent.current?.modelId === m.id;
                      return (
                        <button
                          key={m.id}
                          className={`agent-model-btn${isThisModel ? ' active' : ''}`}
                          disabled={switching === `${activeAgent.id}:${m.id}`}
                          onClick={() => handleSwitch(activeAgent.id, p.id, m.id)}
                        >
                          <span className="agent-model-name">{m.name || m.id}</span>
                          {m.id !== (m.name || m.id) && (
                            <span className="agent-model-id">{m.id}</span>
                          )}
                          {isThisModel && <span className="agent-model-check">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
