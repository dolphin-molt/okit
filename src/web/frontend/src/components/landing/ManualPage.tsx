import { useMemo } from 'react';
import { renderMd } from '../../lib/markdown';
import { useI18n } from '../../i18n';
import okitIcon from '../../assets/branding/okit-icon-command-v1.png';
// The manual lives in the repo's docs/ and is bundled verbatim at build time,
// so the website and the repo always serve the same copy.
import manualMd from '../../../../../../docs/user-manual.md?raw';

export default function ManualPage() {
  const { t } = useI18n();
  const html = useMemo(() => renderMd(manualMd), []);

  return (
    <div className="landing-shell manual-shell">
      <header className="landing-nav">
        <a className="landing-wordmark" href="/landing" aria-label="OKIT landing page">
          <img src={okitIcon} alt="OKIT" className="landing-logo-img" />
          <span>OKIT</span>
        </a>
        <nav className="landing-links" aria-label="Primary">
          <a href="/landing#product">{t('landing.nav.product')}</a>
          <a href="/landing#capabilities">{t('landing.nav.workflow')}</a>
          <a href="/landing#compare">{t('landing.nav.compare')}</a>
          <a href="/landing#install">{t('landing.nav.install')}</a>
        </nav>
        <div className="landing-nav-actions">
          <a className="manual-top-link" href="/landing">← {t('manual.backToSite')}</a>
        </div>
      </header>

      <main className="manual-main">
        <article className="manual-article" dangerouslySetInnerHTML={{ __html: html }} />
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-brand">
            <img src={okitIcon} alt="OKIT" className="landing-logo-img landing-logo-img--sm" />
            © 2026 OKIT
          </span>
          <a href="https://github.com/dolphin-molt/okit">GitHub ↗</a>
        </div>
      </footer>
    </div>
  );
}
