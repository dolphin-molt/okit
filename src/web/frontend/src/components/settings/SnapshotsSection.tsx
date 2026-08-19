import React, { useEffect, useState } from 'react';
import { getAdapters, type AgentInfo } from '../../api/providers';
import {
  listSnapshots, getSnapshotDetail, restoreSnapshot,
  type Snapshot, type SnapshotDetailFile,
} from '../../api/snapshots';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import CustomSelect from '../shared/CustomSelect';

// Snapshot ids look like "2026-08-20T03-34-47-123Z" (ISO with : and . replaced
// by -). Fold that back into a parseable timestamp and render in local time.
function formatSnapshotTime(iso: string): string {
  try {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/.exec(iso);
    if (!m) return iso;
    const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] || '000'}Z`);
    if (Number.isNaN(date.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return iso;
  }
}

export default function SnapshotsSection() {
  const { showToast, confirm } = useApp() as any;
  const { t } = useI18n();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentId, setAgentId] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [detail, setDetail] = useState<SnapshotDetailFile[] | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTime, setDetailTime] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getAdapters();
        if (cancelled) return;
        const list = data.adapters || [];
        setAgents(list);
        if (list.length > 0) setAgentId(list[0].id);
      } catch { /* server unreachable; keep empty state */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await listSnapshots(agentId);
        if (!cancelled) setSnapshots(data.snapshots || []);
      } catch { if (!cancelled) setSnapshots([]); }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  async function openDetail(snapshot: Snapshot) {
    if (!agentId) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setDetailTime(formatSnapshotTime(snapshot.createdAt));
    try {
      const data = await getSnapshotDetail(agentId, snapshot.id);
      setDetail(data.files || []);
    } catch {
      setDetail([]);
      showToast(t('settings.snapshots.restoreFail'), 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetail(null);
  }

  async function handleRestore(snapshot: Snapshot) {
    if (!agentId || restoring) return;
    const ok = await confirm(t('settings.snapshots.confirmBody'), {
      title: t('settings.snapshots.confirmTitle'),
      type: 'warning',
    });
    if (!ok) return;
    setRestoring(true);
    try {
      await restoreSnapshot(agentId, snapshot.id);
      showToast(t('settings.snapshots.restoreOk'), 'success');
      const data = await listSnapshots(agentId);
      setSnapshots(data.snapshots || []);
    } catch {
      showToast(t('settings.snapshots.restoreFail'), 'error');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="settings-section" id="snapshots">
      <div className="settings-block">
        <div className="settings-block-head">
          <span className="settings-block-title">{t('settings.snapshots.title')}</span>
          <div className="settings-block-head-controls">
            <CustomSelect
              className="settings-select-wrap snapshots-select-wrap"
              value={agentId}
              onChange={setAgentId}
              placeholder={t('settings.snapshots.selectAgent')}
              options={agents.map(a => ({ value: a.id, label: a.name }))}
            />
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-body">
            {snapshots.length === 0 ? (
              <div className="snapshots-empty">{t('settings.snapshots.empty')}</div>
            ) : (
              <div className="snapshots-list">
                {snapshots.map(snapshot => (
                  <div key={snapshot.id} className="snapshots-item">
                    <div className="snapshots-item-info">
                      <span className="snapshots-item-time">{formatSnapshotTime(snapshot.createdAt)}</span>
                      <span className="snapshots-item-files">
                        {t('settings.snapshots.fileCount', { n: snapshot.files.length })}
                      </span>
                    </div>
                    <div className="snapshots-item-actions">
                      <button type="button" className="snapshots-btn" onClick={() => openDetail(snapshot)}>
                        {t('settings.snapshots.view')}
                      </button>
                      <button
                        type="button"
                        className="snapshots-btn snapshots-btn--restore"
                        onClick={() => handleRestore(snapshot)}
                        disabled={restoring}
                      >
                        {t('settings.snapshots.restore')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {detailOpen && (
        <div className="usage-guide-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) closeDetail(); }}>
          <section className="usage-guide-panel snapshots-modal" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
            <header className="usage-guide-header">
              <div>
                <span className="usage-guide-eyebrow">{t('settings.snapshots.title')}</span>
                <h2>{t('settings.snapshots.snapshotAt', { time: detailTime })}</h2>
              </div>
              <button className="usage-guide-close" type="button" onClick={closeDetail} aria-label={t('common.close')}>×</button>
            </header>
            {detailLoading ? (
              <div className="snapshots-detail snapshots-detail--loading">{t('settings.snapshots.loading')}</div>
            ) : (
              <div className="snapshots-detail">
                {(detail || []).map(file => (
                  <div key={file.name} className="snapshots-file">
                    <div className="snapshots-file-name">{file.name}</div>
                    <div className="snapshots-file-cols">
                      <div className="snapshots-col">
                        <div className="snapshots-col-title">{t('settings.snapshots.snapshotContent')}</div>
                        <pre className="snapshots-col-body">{file.snapshotContent}</pre>
                      </div>
                      <div className="snapshots-col">
                        <div className="snapshots-col-title">{t('settings.snapshots.currentContent')}</div>
                        {file.currentContent != null
                          ? <pre className="snapshots-col-body">{file.currentContent}</pre>
                          : <div className="snapshots-col-missing">{t('settings.snapshots.fileMissing')}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}