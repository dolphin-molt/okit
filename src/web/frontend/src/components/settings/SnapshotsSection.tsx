import React, { useCallback, useEffect, useState } from 'react';
import ReactDiffViewer, { DiffMethod, type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued';
import { getAdapters, type AgentInfo } from '../../api/providers';
import {
  listSnapshots, getSnapshotDetail, restoreSnapshot,
  type Snapshot, type SnapshotDetailFile,
} from '../../api/snapshots';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';
import CustomSelect from '../shared/CustomSelect';

// Theme the third-party diff viewer with OKIT's palette. Values are plain CSS
// so var() references resolve inside the modal like anywhere else.
const DIFF_STYLES: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: 'var(--paper)',
      diffViewerColor: 'var(--ink)',
      // Title row and summary bar share these; they resolve through CSS
      // variables defined per theme in snapshots.css.
      diffViewerTitleBackground: 'var(--snap-title-bg)',
      diffViewerTitleColor: 'var(--snap-title-fg)',
      diffViewerTitleBorderColor: 'var(--snap-title-border)',
      gutterBackground: 'rgba(0, 0, 0, 0.02)',
      gutterColor: 'var(--ink-muted)',
      addedBackground: 'rgba(5, 150, 105, 0.10)',
      addedColor: 'var(--green)',
      addedGutterBackground: 'rgba(5, 150, 105, 0.08)',
      addedGutterColor: 'var(--green)',
      removedBackground: 'rgba(220, 38, 38, 0.10)',
      removedColor: 'var(--red)',
      removedGutterBackground: 'rgba(220, 38, 38, 0.08)',
      removedGutterColor: 'var(--red)',
      wordAddedBackground: 'rgba(5, 150, 105, 0.22)',
      wordRemovedBackground: 'rgba(220, 38, 38, 0.22)',
      codeFoldBackground: 'rgba(0, 0, 0, 0.035)',
      codeFoldGutterBackground: 'rgba(0, 0, 0, 0.035)',
    },
    dark: {
      diffViewerBackground: '#24221e',
      diffViewerColor: 'var(--ink)',
      diffViewerTitleBackground: 'var(--snap-title-bg)',
      diffViewerTitleColor: 'var(--snap-title-fg)',
      diffViewerTitleBorderColor: 'var(--snap-title-border)',
      gutterBackground: 'rgba(255, 255, 255, 0.03)',
      gutterColor: 'var(--ink-muted)',
      addedBackground: 'rgba(52, 211, 153, 0.12)',
      addedColor: 'var(--green)',
      addedGutterBackground: 'rgba(52, 211, 153, 0.10)',
      addedGutterColor: 'var(--green)',
      removedBackground: 'rgba(248, 113, 113, 0.12)',
      removedColor: 'var(--red)',
      removedGutterBackground: 'rgba(248, 113, 113, 0.10)',
      removedGutterColor: 'var(--red)',
      wordAddedBackground: 'rgba(52, 211, 153, 0.28)',
      wordRemovedBackground: 'rgba(248, 113, 113, 0.28)',
      codeFoldBackground: 'rgba(255, 255, 255, 0.04)',
      codeFoldGutterBackground: 'rgba(255, 255, 255, 0.04)',
    },
  },
  diffContainer: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '12px',
  },
  titleBlock: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    fontFamily: 'var(--font)',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  summary: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '11px',
    borderBottom: '1px solid var(--snap-title-border)',
  },
  // Nothing is foldable in full-file mode, so the bar's expand-all button
  // would be a dead control — hide it and keep count + distribution strip.
  allExpandButton: {
    display: 'none',
  },
  // The lib renders the "no counterpart line" cells via backgroundColor, which
  // cannot carry a gradient. Draw the hatch ourselves through a theme-aware
  // CSS variable instead (see snapshots.css).
  emptyLine: {
    backgroundColor: 'transparent',
    backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 5px, var(--snap-hatch) 5px 10px)',
  },
};

function paneTitle(kind: 'old' | 'new', label: string) {
  return (
    <span className={`snapshots-pane-title snapshots-pane-title--${kind}`}>
      <i className="snapshots-pane-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// Syntax-highlight languages understood by the viewer's Prism integration,
// keyed by file extension. Unknown extensions stay unhighlighted.
const HIGHLIGHT_LANGS: Record<string, string> = {
  json: 'json',
  jsonc: 'json',
  toml: 'toml',
  sh: 'bash',
  bash: 'bash',
};

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

// jsdiff's JSON mode canonicalizes (sorts keys) before comparing, so key
// reordering alone no longer shows up as a mass add/delete. It renders the
// canonicalized text, so only use it when both sides are strictly parseable;
// jsonc with comments or empty sides fall back to the line diff.
function jsonCompareMethod(file: SnapshotDetailFile): DiffMethod | undefined {
  const ext = fileExt(file.name);
  if (ext !== 'json' && ext !== 'jsonc') return undefined;
  try {
    JSON.parse(file.snapshotContent ?? 'null');
    JSON.parse(file.currentContent ?? 'null');
    return DiffMethod.JSON;
  } catch {
    return undefined;
  }
}

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

// Compact stamp for list rows: today → HH:mm, this year → MM-DD HH:mm,
// otherwise the date only. The modal keeps the full timestamp.
function formatShortTime(iso: string): string {
  const full = formatSnapshotTime(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(full);
  if (!m) return full;
  const now = new Date();
  const [, y, mo, d, hh, mm] = m;
  const sameDay = Number(y) === now.getFullYear()
    && Number(mo) === now.getMonth() + 1
    && Number(d) === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  if (Number(y) === now.getFullYear()) return `${mo}-${d} ${hh}:${mm}`;
  return `${y}-${mo}-${d}`;
}

type SnapshotItem = Snapshot & { agentId: string; agentName: string };

export default function SnapshotsSection() {
  const { showToast, confirm, theme } = useApp() as any;
  const { t } = useI18n();

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  // '' means "all agents" — the default landing view shows every snapshot.
  const [filterAgent, setFilterAgent] = useState('');
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [detail, setDetail] = useState<SnapshotDetailFile[] | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTime, setDetailTime] = useState('');
  const [detailAgentName, setDetailAgentName] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSnapshot, setDetailSnapshot] = useState<SnapshotItem | null>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getAdapters();
        if (cancelled) return;
        setAgents(data.adapters || []);
      } catch { /* server unreachable; keep empty state */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const reloadSnapshots = useCallback(async () => {
    if (agents.length === 0) return;
    setListLoading(true);
    const targets = filterAgent ? agents.filter(a => a.id === filterAgent) : agents;
    const results = await Promise.all(targets.map(async a => {
      try {
        const data = await listSnapshots(a.id);
        return (data.snapshots || []).map(s => ({ ...s, agentId: a.id, agentName: a.name }));
      } catch { return [] as SnapshotItem[]; }
    }));
    setSnapshots(results.flat().sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
    setListLoading(false);
  }, [agents, filterAgent]);

  useEffect(() => {
    reloadSnapshots();
  }, [reloadSnapshots]);

  async function openDetail(snapshot: SnapshotItem) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setActiveFile(0);
    setDetailSnapshot(snapshot);
    setDetailTime(formatSnapshotTime(snapshot.createdAt));
    setDetailAgentName(snapshot.agentName);
    try {
      const data = await getSnapshotDetail(snapshot.agentId, snapshot.id);
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
    setDetailSnapshot(null);
  }

  async function handleRestore(snapshot: SnapshotItem) {
    if (restoring) return;
    const ok = await confirm(t('settings.snapshots.confirmBody'), {
      title: t('settings.snapshots.confirmTitle'),
      type: 'warning',
    });
    if (!ok) return;
    setRestoring(true);
    try {
      await restoreSnapshot(snapshot.agentId, snapshot.id);
      showToast(t('settings.snapshots.restoreOk'), 'success');
      if (detailOpen) closeDetail();
      await reloadSnapshots();
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
              value={filterAgent}
              onChange={setFilterAgent}
              placeholder={t('settings.snapshots.selectAgent')}
              options={[
                { value: '', label: t('settings.snapshots.allAgents') },
                ...agents.map(a => ({ value: a.id, label: a.name })),
              ]}
            />
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-body">
            {listLoading && snapshots.length === 0 ? (
              <div className="snapshots-empty">{t('settings.snapshots.loading')}</div>
            ) : snapshots.length === 0 ? (
              <div className="snapshots-empty">{t('settings.snapshots.empty')}</div>
            ) : (
              <div className="snapshots-list">
                {snapshots.map(snapshot => (
                  <div key={`${snapshot.agentId}/${snapshot.id}`} className="snapshots-item">
                    <div className="snapshots-item-info">
                      <span className="snapshots-item-agent">{snapshot.agentName}</span>
                      <span className="snapshots-item-time">{formatShortTime(snapshot.createdAt)}</span>
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
            {(() => {
              const files = detail || [];
              const current = files[Math.min(activeFile, Math.max(files.length - 1, 0))] ?? null;
              return (
                <>
                  <div className="snapshots-topbar">
                    <span className="snapshots-topbar-label">{detailAgentName}</span>
                    <span className="snapshots-topbar-time">{detailTime}</span>
                    <div className="snapshots-topbar-file">
                      {files.length > 1 && (
                        <div className="snapshots-topbar-tabs" role="tablist">
                          {files.map((f, i) => (
                            <button
                              key={f.name}
                              type="button"
                              role="tab"
                              aria-selected={i === activeFile}
                              className={`snapshots-tab${i === activeFile ? ' snapshots-tab--active' : ''}`}
                              onClick={() => setActiveFile(i)}
                            >
                              {f.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {current && current.currentContent == null && (
                        <span className="snapshots-file-missing">{t('settings.snapshots.fileMissing')}</span>
                      )}
                      {detailSnapshot && (
                        <button
                          type="button"
                          className="snapshots-topbar-restore"
                          onClick={() => handleRestore(detailSnapshot)}
                          disabled={restoring || detailLoading}
                        >
                          {t('settings.snapshots.restore')}
                        </button>
                      )}
                      <button className="snapshots-topbar-close" type="button" onClick={closeDetail} aria-label={t('common.close')}>×</button>
                    </div>
                  </div>
                  {detailLoading ? (
                    <div className="snapshots-detail snapshots-detail--loading">{t('settings.snapshots.loading')}</div>
                  ) : current ? (
                    <div className="snapshots-detail">
                      <div className="snapshots-diffwrap">
                        <ReactDiffViewer
                          oldValue={current.snapshotContent ?? ''}
                          newValue={current.currentContent ?? ''}
                          splitView
                          showDiffOnly={false}
                          disableWorker
                          useDarkTheme={theme === 'dark'}
                          compareMethod={jsonCompareMethod(current) ?? undefined}
                          highlightLanguage={HIGHLIGHT_LANGS[fileExt(current.name)]}
                          summary={<span className="snapshots-summary-name">{current.name}</span>}
                          leftTitle={paneTitle('old', t('settings.snapshots.paneSnapshot'))}
                          rightTitle={paneTitle('new', t('settings.snapshots.paneCurrent'))}
                          styles={DIFF_STYLES}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="snapshots-detail snapshots-detail--loading">{t('settings.snapshots.noFiles')}</div>
                  )}
                </>
              );
            })()}
          </section>
        </div>
      )}
    </div>
  );
}
