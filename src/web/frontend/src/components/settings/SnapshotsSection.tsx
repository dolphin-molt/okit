import React, { useEffect, useState } from 'react';
import { getAdapters, type AgentInfo } from '../../api/providers';
import {
  listSnapshots, getSnapshotDetail, restoreSnapshot,
  type Snapshot, type SnapshotDetailFile,
} from '../../api/snapshots';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import { diffLines, toSideBySide } from '../../lib/lineDiff';
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
            <div className="snapshots-topbar">
              <span className="snapshots-topbar-label">{t('settings.snapshots.title')}</span>
              <span className="snapshots-topbar-time">{detailTime}</span>
              <button className="snapshots-topbar-close" type="button" onClick={closeDetail} aria-label={t('common.close')}>×</button>
            </div>
            {detailLoading ? (
              <div className="snapshots-detail snapshots-detail--loading">{t('settings.snapshots.loading')}</div>
            ) : (
              <div className="snapshots-detail">
                {(detail || []).map(file => {
                  const diff = file.currentContent != null
                    ? diffLines(file.snapshotContent ?? '', file.currentContent)
                    : null;
                  return (
                    <div key={file.name} className="snapshots-file">
                      <div className="snapshots-file-name">
                        <span>{file.name}</span>
                        {diff ? (
                          <span className="snapshots-diff-stats">
                            {diff.adds > 0 && <span className="snapshots-diff-adds">+{diff.adds}</span>}
                            {diff.dels > 0 && <span className="snapshots-diff-dels">−{diff.dels}</span>}
                            {diff.adds === 0 && diff.dels === 0 && (
                              <span className="snapshots-diff-same">{t('settings.snapshots.noDiff')}</span>
                            )}
                          </span>
                        ) : (
                          <span className="snapshots-file-missing">{t('settings.snapshots.fileMissing')}</span>
                        )}
                      </div>
                      {diff && (diff.adds > 0 || diff.dels > 0) && (
                        <div className="snapshots-sdiff">
                          <div className="snapshots-sdiff-titles">
                            <div>{t('settings.snapshots.paneSnapshot')}</div>
                            <div>{t('settings.snapshots.paneCurrent')}</div>
                          </div>
                          {diff.hunks.flatMap((hunk, hi) =>
                            toSideBySide(hunk).map((row, ri) => {
                              const key = `${hi}-${ri}`;
                              if (row.kind === 'hunk') {
                                return <div key={key} className="snapshots-sdiff-hunkhdr">{row.header}</div>;
                              }
                              return (
                                <div key={key} className="snapshots-sdiff-row">
                                  <span className="snapshots-sdiff-num">{row.left?.num ?? ''}</span>
                                  <code className={`snapshots-sdiff-code is-left${row.left ? ` snapshots-sdiff-code--${row.left.op}` : ' snapshots-sdiff-code--empty'}`}>
                                    {row.left ? row.left.text : '\u00a0'}
                                  </code>
                                  <span className="snapshots-sdiff-num">{row.right?.num ?? ''}</span>
                                  <code className={`snapshots-sdiff-code${row.right ? ` snapshots-sdiff-code--${row.right.op}` : ' snapshots-sdiff-code--empty'}`}>
                                    {row.right ? row.right.text : '\u00a0'}
                                  </code>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}