import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMd } from '../../lib/markdown';
import { useI18n } from '../../i18n';
import okitIcon from '../../assets/branding/okit-icon-command-v1.png';
// Both manuals live in the repo's docs/ and are bundled verbatim at build time,
// so the website and the repo always serve the same copy.
import manualZh from '../../../../../../docs/user-manual.md?raw';
import manualEn from '../../../../../../docs/user-manual.en.md?raw';
import { GithubIcon } from './icons';

interface TocEntry {
  id: string;
  level: 3 | 4;
  text: string;
}

/** Render markdown, then inject stable ids into h3/h4 for TOC anchors. */
function renderManual(md: string): { html: string; toc: TocEntry[] } {
  let html = renderMd(md);
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
  const { t, lang, setLang } = useI18n();
  const nextLang = lang === 'zh' ? 'en' : 'zh';
  const { html, toc } = useMemo(
    () => renderManual(lang === 'zh' ? manualZh : manualEn),
    [lang],
  );
  const [activeId, setActiveId] = useState<string>(toc[0]?.id ?? '');
  const scrollColRef = useRef<HTMLDivElement>(null);

  // Reset scroll + active section when the language switches.
  useEffect(() => {
    scrollColRef.current?.scrollTo({ top: 0 });
    setActiveId(toc[0]?.id ?? '');
  }, [toc]);

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
        <span className="landing-wordmark">
          <img src={okitIcon} alt="OKIT" className="landing-logo-img" />
          <span>OKIT</span>
        </span>
        <nav className="landing-links" aria-label="Primary">
          <a href="/manual" className="active">{t('manual.nav')}</a>
        </nav>
        <div className="landing-nav-actions">
          <a className="landing-gh" href="https://github.com/dolphin-molt/okit" aria-label="GitHub" target="_blank" rel="noopener">
            <GithubIcon />
          </a>
          <button
            className="landing-lang-toggle"
            onClick={() => setLang(nextLang)}
            title={t('nav.language')}
            type="button"
          >
            {lang === 'zh' ? 'EN' : '中'}
          </button>
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
