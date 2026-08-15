import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMd } from '../../lib/markdown';
import { useI18n } from '../../i18n';
import okitIcon from '../../assets/branding/okit-icon-command-v1.png';
// The manual lives in the repo's docs/ and is bundled verbatim at build time,
// so the website and the repo always serve the same copy.
import manualMd from '../../../../../../docs/user-manual.md?raw';

interface TocEntry {
  id: string;
  level: 3 | 4;
  text: string;
}

/** Render markdown, then inject stable ids into h3/h4 for TOC anchors. */
function renderManual(): { html: string; toc: TocEntry[] } {
  let html = renderMd(manualMd);
  const toc: TocEntry[] = [];
  let i = 0;
  html = html.replace(/<(h[34])>([^<]+)<\/h[34]>/g, (match, tag, text) => {
    const id = `manual-sec-${i++}`;
    toc.push({ id, level: tag === 'h3' ? 3 : 4, text });
    return `<${tag} id="${id}">${text}</${tag}>`;
  });
  return { html, toc };
}

export default function ManualPage() {
  const { t } = useI18n();
  const { html, toc } = useMemo(renderManual, []);
  const [activeId, setActiveId] = useState<string>(toc[0]?.id ?? '');
  const scrollColRef = useRef<HTMLDivElement>(null);

  // Highlight the section currently at the top of the article scroll area.
  useEffect(() => {
    const col = scrollColRef.current;
    if (!col) return;
    const onScroll = () => {
      let current = toc[0]?.id ?? '';
      for (const entry of toc) {
        const el = document.getElementById(entry.id);
        if (el && el.getBoundingClientRect().top <= 120) {
          current = entry.id;
        }
      }
      setActiveId(current);
    };
    onScroll();
    col.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      col.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [toc]);

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
        <aside className="manual-toc" aria-label="Table of contents">
          <span className="manual-toc-title">{t('manual.toc')}</span>
          {toc.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className={`manual-toc-link${entry.level === 4 ? ' manual-toc-link--sub' : ''}${entry.id === activeId ? ' active' : ''}`}
            >
              {entry.text}
            </a>
          ))}
        </aside>
        <div className="manual-article-col" ref={scrollColRef}>
          <article className="manual-article" dangerouslySetInnerHTML={{ __html: html }} />
          <footer className="landing-footer manual-footer">
            <div className="landing-footer-inner">
              <span className="landing-footer-brand">
                <img src={okitIcon} alt="OKIT" className="landing-logo-img landing-logo-img--sm" />
                © 2026 OKIT
              </span>
              <a href="https://github.com/dolphin-molt/okit">GitHub ↗</a>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
