// Goal ②: a "quick tools" launcher strip for the home dashboard.
//
// Shows the user's agents as one-click launch buttons, prioritizing those that
// already have a model selected (agent.current set) so the daily-use tools
// surface first. Clicking a button calls launchAgent — the same endpoint the
// existing agent header uses.

import { useEffect, useState } from 'react';
import { getAdapters, launchAgent, AgentInfo } from '../../api/providers';
import { getAgentIcon } from '../../assets/agents';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

export default function QuickTools() {
  const { t } = useI18n();
  const { showToast } = useApp();
  const [adapters, setAdapters] = useState<AgentInfo[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);

  useEffect(() => {
    getAdapters().then(data => setAdapters(data.adapters || [])).catch(() => {});
  }, []);

  const handleLaunch = async (agent: AgentInfo) => {
    setLaunching(agent.id);
    try {
      await launchAgent(agent.id);
      showToast(t('agents.launchTerminal'), 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLaunching(null);
    }
  };

  // Configured agents (have a model selected) first, then the rest.
  const sorted = [...adapters].sort((a, b) => {
    const sa = a.current ? 0 : 1;
    const sb = b.current ? 0 : 1;
    return sa - sb;
  });
  const tools = sorted.slice(0, 8);

  if (tools.length === 0) return null;

  return (
    <section className="home-section">
      <h3 className="home-section-title">{t('home.quickTools')}</h3>
      <div className="quick-tools-grid">
        {tools.map(a => {
          const icon = getAgentIcon(a.id);
          return (
            <button
              key={a.id}
              type="button"
              className={`quick-tool-btn${a.current ? ' quick-tool-btn--active' : ''}`}
              disabled={!a.canLaunch || a.installed === false || launching === a.id}
              onClick={() => handleLaunch(a)}
              title={a.name + (a.current ? ` · ${a.current.modelId}` : '')}
            >
              {launching === a.id ? (
                <span className="agent-icon-loading" />
              ) : icon ? (
                <img src={icon} alt="" className="quick-tool-icon" />
              ) : (
                <span className="quick-tool-icon-fallback">{a.name.slice(0, 1)}</span>
              )}
              <span className="quick-tool-name">{a.name}</span>
              {a.current && <span className="quick-tool-model">{a.current.modelId}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
