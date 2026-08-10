import { useState } from 'react';
import { AgentInfo } from '../../api/providers';
import { useI18n } from '../../i18n';

export default function ModelPickerModal({ agent, switching, onSwitch, onClose }: {
  agent: AgentInfo;
  switching: string | null;
  onSwitch: (agentId: string, providerId: string, modelId: string) => void;
  onClose: () => void;
}) {
  const { t, providerName } = useI18n();

  const providers = agent.compatibleProviders;
  const [selectedProvider, setSelectedProvider] = useState<string | null>(() => {
    if (agent.current?.providerId && providers.some(p => p.id === agent.current?.providerId)) {
      return agent.current.providerId;
    }
    return providers[0]?.id || null;
  });
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
                aria-current={agent.current?.providerId === p.id ? 'true' : undefined}
                onClick={() => setSelectedProvider(p.id)}
              >
                <span className="picker-provider-name">{providerName(p.id, p.name)}</span>
                {agent.current?.providerId === p.id && (
                  <span className="picker-provider-current">{t('agents.current')}</span>
                )}
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
                        aria-current={isCurrent ? 'true' : undefined}
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
