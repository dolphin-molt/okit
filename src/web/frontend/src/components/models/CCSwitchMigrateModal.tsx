import React, { useEffect, useState } from 'react';
import { scanCCSwitch, type CCSwitchItem, type CCSwitchScan } from '../../api/ccswitch';
import { setVault } from '../../api/vault';
import { createProvider } from '../../api/providers';
import { useApp } from '../Layout/AppContext';
import { useI18n } from '../../i18n';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'provider';
}

type Props = {
  onClose: () => void;
  onImported: () => void;
  existingIds: Set<string>;
};

export default function CCSwitchMigrateModal({ onClose, onImported, existingIds }: Props) {
  const { showToast } = useApp() as any;
  const { t } = useI18n();
  const [scan, setScan] = useState<CCSwitchScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ ok: number; fail: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await scanCCSwitch();
        if (cancelled) return;
        setScan(data);
        setSelected(new Set((data.providers || []).map((_, i) => i)));
      } catch (err: any) {
        if (!cancelled) showToast(err.message, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  function toggle(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function importSelected() {
    if (!scan || importing) return;
    const items = scan.providers.filter((_, i) => selected.has(i));
    if (items.length === 0) return;
    setImporting(true);
    let ok = 0;
    let fail = 0;
    for (const item of items as CCSwitchItem[]) {
      try {
        let base = `cc-${slugify(item.name)}`;
        let id = base;
        let n = 2;
        while (existingIds.has(id)) id = `${base}-${n++}`;
        existingIds.add(id);

        let vaultKey: string | undefined;
        if (item.apiKey) {
          vaultKey = `${slugify(item.name)}_api_key`;
          await setVault({ key: vaultKey, value: item.apiKey, desc: 'cc-switch', group: item.name });
        }

        const type = item.source === 'claude' ? 'anthropic' : 'openai';
        await createProvider({
          id,
          name: item.name,
          type,
          baseUrl: item.baseUrl,
          endpoints: [{
            type,
            baseUrl: item.baseUrl,
            ...(item.protocol ? { protocol: item.protocol } : {}),
          }],
          ...(vaultKey ? { vaultKey } : {}),
          authMode: vaultKey ? 'api_key' : 'none',
          models: [],
        } as any);
        ok++;
      } catch {
        fail++;
      }
    }
    setImporting(false);
    setDone({ ok, fail });
    if (ok > 0) {
      showToast(t('models.ccswitch.importOk', { n: ok }), 'success');
      onImported();
    }
    if (fail > 0) showToast(t('models.ccswitch.importFail', { n: fail }), 'error');
    if (fail === 0) setTimeout(onClose, 600);
  }

  const reasonText: Record<string, string> = {
    no_base_url: t('models.ccswitch.reasonNoBaseUrl'),
    subscription_only: t('models.ccswitch.reasonSubscription'),
    unparsed: t('models.ccswitch.reasonUnparsed'),
  };

  return (
    <div className="usage-guide-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="usage-guide-panel ccswitch-modal" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
        <header className="usage-guide-header">
          <div>
            <span className="usage-guide-eyebrow">{t('models.ccswitch.eyebrow')}</span>
            <h2>{t('models.ccswitch.title')}</h2>
            <p>{t('models.ccswitch.desc')}</p>
          </div>
          <button className="usage-guide-close" type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>
        <div className="ccswitch-body">
          {loading ? (
            <div className="ccswitch-status">{t('common.loading')}</div>
          ) : !scan || !scan.found ? (
            <div className="ccswitch-status">
              {scan?.reason === 'sqlite_cli_missing'
                ? t('models.ccswitch.sqliteMissing')
                : t('models.ccswitch.notFound')}
            </div>
          ) : scan.providers.length === 0 ? (
            <div className="ccswitch-status">{t('models.ccswitch.nothingToImport')}</div>
          ) : (
            <>
              <div className="ccswitch-count">{t('models.ccswitch.foundN', { n: scan.providers.length })}</div>
              <div className="ccswitch-list">
                {scan.providers.map((item, i) => (
                  <label key={`${item.name}-${i}`} className={`ccswitch-item${selected.has(i) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} disabled={importing} />
                    <span className="ccswitch-item-main">
                      <span className="ccswitch-item-name">
                        {item.name}
                        <span className={`ccswitch-item-source ccswitch-item-source--${item.source}`}>
                          {item.source === 'claude' ? 'Claude' : 'Codex'}
                        </span>
                      </span>
                      <code className="ccswitch-item-url">{item.baseUrl}</code>
                    </span>
                    <span className={`ccswitch-item-key${item.apiKey ? '' : ' none'}`}>
                      {item.apiKey ? t('models.ccswitch.hasKey') : t('models.ccswitch.noKey')}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          {!loading && scan && scan.skipped.length > 0 && (
            <div className="ccswitch-skipped">
              <div className="ccswitch-skipped-title">{t('models.ccswitch.skippedN', { n: scan.skipped.length })}</div>
              {scan.skipped.map((s, i) => (
                <div key={i} className="ccswitch-skipped-row">
                  <span>{s.name}</span>
                  <span className="ccswitch-skipped-reason">{reasonText[s.reason] || s.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="ccswitch-footer">
          {done ? (
            <span className={`ccswitch-result${done.fail > 0 ? ' partial' : ''}`}>
              {t('models.ccswitch.result', { ok: done.ok, fail: done.fail })}
            </span>
          ) : (
            <span className="ccswitch-hint">{t('models.ccswitch.hint')}</span>
          )}
          <div className="ccswitch-footer-actions">
            <button type="button" className="ccswitch-btn" onClick={onClose} disabled={importing}>
              {done ? t('common.close') : t('common.cancel')}
            </button>
            {!done && (
              <button
                type="button"
                className="ccswitch-btn ccswitch-btn--primary"
                onClick={importSelected}
                disabled={importing || selected.size === 0}
              >
                {importing ? t('common.loading') : t('models.ccswitch.importN', { n: selected.size })}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
