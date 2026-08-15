import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { getProviderIcon } from '../../assets/providers';
import { getAgentIcon } from '../../assets/agents';
import okitIcon from '../../assets/branding/okit-icon-command-v1.png';

/* ---------------- motion helpers (React-Bits-style, self-implemented) ---------------- */

/** Scroll reveal: fades/slides in once when entering the viewport.
 *  Uses scroll + getBoundingClientRect (not IntersectionObserver) so it also
 *  works in embedded webviews where IO callbacks are throttled. */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const check = () => {
      if (done) return;
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.88 && r.bottom > 0) {
        done = true;
        setInView(true);
        window.removeEventListener('scroll', check);
        window.removeEventListener('resize', check);
      }
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`landing-reveal ${inView ? 'in' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Animated number counter for the metric ledger. */
function CountUp({ target }: { target: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <span ref={ref}>0</span>;
}

/** Spotlight: cursor-following lime glow over a card. */
function Spot({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`landing-spot ${className}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

/** Split-text: hero headline enters character by character. */
function SplitChars({ text }: { text: string }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span className="landing-char" style={{ animationDelay: `${i * 32}ms` }} key={i}>
          {ch === ' ' ? '\u00A0' : ch}
        </span>
      ))}
    </>
  );
}

/* ---------------- mock data (mirrors the real product) ---------------- */

const marqueeIds = [
  'anthropic', 'openai', 'deepseek', 'zai', 'moonshot', 'volcengine',
  'minimax', 'qwen', 'qianfan', 'tencent', 'siliconflow', 'xiaomi',
  'openrouter', 'github-copilot', 'ollama',
];

const platformGroups: Array<{ labelKey: string; ids: string[] }> = [
  { labelKey: 'landing.platform.intl', ids: ['anthropic', 'openai', 'mistral', 'xai', 'openrouter', 'github-copilot'] },
  { labelKey: 'landing.platform.cn', ids: ['zai', 'moonshot', 'deepseek', 'volcengine', 'minimax', 'qwen', 'qianfan', 'tencent', 'siliconflow', 'xiaomi', 'stepfun'] },
  { labelKey: 'landing.platform.local', ids: ['ollama', 'litellm'] },
];

const mockAgents = [
  { id: 'claude', name: 'Claude Code', active: true },
  { id: 'codex', name: 'ChatGPT', active: false },
  { id: 'kimi-code', name: 'Kimi', active: false },
  { id: 'hermes', name: 'Hermes', active: false },
  { id: 'workbuddy', name: 'WorkBuddy', active: false },
];

const mockProviders = [
  { icon: 'zai', name: '智谱 Coding Plan', on: true, models: ['GLM-5', 'GLM-5-Air', 'GLM-5-Flash'], activeModel: 'GLM-5' },
  { icon: 'minimax', name: 'MiniMax Coding', on: false, models: ['MiniMax-M2'], activeModel: null },
];

const mockUsage = [
  { icon: 'claude', name: 'Claude', window: '5h', remaining: 8 },
  { icon: 'zai', name: 'GLM', window: '周', remaining: 62 },
  { icon: 'deepseek', name: 'DeepSeek', window: '余额', remaining: 81 },
];

const metrics: Array<{ value?: string; count?: number; suffix?: string; labelKey: string }> = [
  { count: 29, suffix: '+', labelKey: 'landing.metric.providers' },
  { count: 8, labelKey: 'landing.metric.agents' },
  { value: 'AES-256', labelKey: 'landing.metric.vault' },
  { count: 15, labelKey: 'landing.metric.usage' },
];

const compareRows: Array<{ labelKey: string; manual: string; switcher: string; okit: string }> = [
  { labelKey: 'landing.compare.row.switch', manual: '✗', switcher: '✓', okit: '✓' },
  { labelKey: 'landing.compare.row.vault', manual: '✗', switcher: '—', okit: '✓' },
  { labelKey: 'landing.compare.row.autocreate', manual: '✗', switcher: '✗', okit: '✓' },
  { labelKey: 'landing.compare.row.usage', manual: '✗', switcher: '✗', okit: '✓' },
  { labelKey: 'landing.compare.row.assistant', manual: '✗', switcher: '✗', okit: '✓' },
  { labelKey: 'landing.compare.row.agentapi', manual: '✗', switcher: '✗', okit: '✓' },
  { labelKey: 'landing.compare.row.agents', manual: '✗', switcher: '~', okit: '✓' },
];

const faqKeys = ['security', 'agents', 'autocreate', 'skill', 'data'];

/* ---------------- page ---------------- */

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const nextLang = lang === 'zh' ? 'en' : 'zh';

  const capabilityVisual = (id: string) => {
    switch (id) {
      case 'agents':
        return (
          <div className="landing-mock-section">
            <span className="landing-mock-title">{t('home.agentConfig')}</span>
            <div className="landing-agent-tabs">
              {mockAgents.map((a) => {
                const icon = getAgentIcon(a.id);
                return (
                  <span className={`landing-agent-tab${a.active ? ' active' : ''}`} key={a.id}>
                    {icon && <img src={icon} alt="" />}
                    {a.name}
                  </span>
                );
              })}
            </div>
            <div className="landing-pcards">
              {mockProviders.map((p) => {
                const icon = getProviderIcon(p.icon);
                return (
                  <div className="landing-pcard" key={p.name}>
                    <div className="landing-pcard-head">
                      {icon && <img src={icon} alt="" className="landing-pcard-logo" />}
                      <span className="landing-pcard-name">{p.name}</span>
                      <span className={`landing-switch${p.on ? ' on' : ''}`}><i /></span>
                    </div>
                    <div className="landing-pcard-models">
                      {p.models.map((m) => (
                        <span className={`landing-model-chip${m === p.activeModel ? ' active' : ''}`} key={m}>{m}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="landing-mock-note">$ okit · claude → zhipu · GLM-5 · config.toml + auth.json ✓</div>
          </div>
        );
      case 'platforms':
        return (
          <div className="landing-mock-section">
            {platformGroups.map((g) => (
              <div className="landing-platform-group" key={g.labelKey}>
                <span className="landing-mock-title">{t(g.labelKey)}</span>
                <div className="landing-platform-logos">
                  {g.ids.map((id) => {
                    const src = getProviderIcon(id);
                    return src ? (
                      <span className="landing-logo-chip landing-logo-chip--sm" key={id}>
                        <img src={src} alt="" loading="lazy" />
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            ))}
            <div className="landing-plan-badges">
              {['Coding Plan', 'Token Plan', '订阅', '按量付费'].map((b) => (
                <span key={b}>{b}</span>
              ))}
            </div>
          </div>
        );
      case 'vault':
        return (
          <div className="landing-mock-section">
            <div className="landing-flow">
              {[
                { n: '1', key: 'landing.vault.step1' },
                { n: '2', key: 'landing.vault.step2' },
                { n: '3', key: 'landing.vault.step3' },
              ].map((s) => (
                <div className="landing-flow-step" key={s.n}>
                  <span className="landing-flow-num">{s.n}</span>
                  <span>{t(s.key)}</span>
                </div>
              ))}
            </div>
            <div className="landing-vault-strip">
              <span className="landing-vault-badge">AES-256-GCM</span>
              <code>sk-…•••7f2a → ~/.okit/vault (encrypted)</code>
            </div>
          </div>
        );
      case 'usage':
        return (
          <div className="landing-mock-section">
            <div className="landing-alert-banner">
              <span className="landing-alert-dot" />
              {t('landing.usage.alert')}
            </div>
            <div className="landing-usage-rows">
              {mockUsage.map((u) => {
                const icon = getProviderIcon(u.icon) || getAgentIcon(u.icon);
                const tone = u.remaining <= 10 ? 'danger' : u.remaining <= 30 ? 'warn' : 'ok';
                return (
                  <div className="landing-usage-row" key={u.name}>
                    {icon && <img src={icon} alt="" className="landing-usage-logo" />}
                    <span className="landing-usage-name">{u.name}</span>
                    <span className="landing-usage-window">{u.window}</span>
                    <span className="landing-usage-track">
                      <i className={`landing-usage-fill--${tone}`} style={{ width: `${u.remaining}%` }} />
                    </span>
                    <span className={`landing-usage-value landing-usage-value--${tone}`}>{u.remaining}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'assistant':
        return (
          <div className="landing-mock-section landing-chat">
            <div className="landing-bubble landing-bubble--user">{t('landing.assistant.q')}</div>
            <div className="landing-bubble landing-bubble--ai">{t('landing.assistant.a')}</div>
          </div>
        );
      case 'sync':
        return (
          <div className="landing-mock-section landing-sync">
            <div className="landing-sync-node">{t('landing.sync.thisMac')}</div>
            <div className="landing-sync-link">⇄</div>
            <div className="landing-sync-node landing-sync-node--cloud">
              Cloudflare KV
              <em>E2E</em>
            </div>
            <div className="landing-sync-link">⇄</div>
            <div className="landing-sync-node">{t('landing.sync.devices')}</div>
          </div>
        );
      default:
        return null;
    }
  };

  const capabilities: Array<{ id: string; num: string; titleKey: string; bodyKey: string; badgeKey?: string }> = [
    { id: 'agents', num: '01', titleKey: 'landing.cap.agents.title', bodyKey: 'landing.cap.agents.body' },
    { id: 'platforms', num: '02', titleKey: 'landing.cap.platforms.title', bodyKey: 'landing.cap.platforms.body' },
    { id: 'vault', num: '03', titleKey: 'landing.cap.vault.title', bodyKey: 'landing.cap.vault.body', badgeKey: 'landing.cap.vault.badge' },
    { id: 'usage', num: '04', titleKey: 'landing.cap.usage.title', bodyKey: 'landing.cap.usage.body' },
    { id: 'assistant', num: '05', titleKey: 'landing.cap.assistant.title', bodyKey: 'landing.cap.assistant.body' },
    { id: 'sync', num: '06', titleKey: 'landing.cap.sync.title', bodyKey: 'landing.cap.sync.body' },
    { id: 'cli', num: '07', titleKey: 'landing.cap.cli.title', bodyKey: 'landing.cap.cli.body' },
  ];

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <a className="landing-wordmark" href="/landing" aria-label="OKIT landing page">
          <img src={okitIcon} alt="OKIT" className="landing-logo-img" />
          <span>OKIT</span>
        </a>
        <nav className="landing-links" aria-label="Primary">
          <a href="#product">{t('landing.nav.product')}</a>
          <a href="#capabilities">{t('landing.nav.workflow')}</a>
          <a href="#compare">{t('landing.nav.compare')}</a>
          <a href="#install">{t('landing.nav.install')}</a>
          <a href="https://github.com/dolphin-molt/okit">{t('landing.nav.github')}</a>
        </nav>
        <div className="landing-nav-actions">
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

      <main>
        <section className="landing-hero" id="product">
          <div className="landing-hero-copy">
            <p className="landing-terminal-line">$ okit web</p>
            <h1><SplitChars text={t('landing.hero.title')} /></h1>
            <p className="landing-lede">{t('landing.lede')}</p>
            <div className="landing-actions">
              <a className="landing-btn landing-btn--primary" href="#install">{t('landing.cta.install')}</a>
              <a className="landing-btn landing-btn--secondary" href="/">{t('landing.cta.dashboard')}</a>
            </div>
            <div className="landing-metrics" aria-label="Product highlights">
              {metrics.map((m) => (
                <div className="landing-metric" key={m.labelKey}>
                  <strong>
                    {m.count !== undefined ? <><CountUp target={m.count} />{m.suffix ?? ''}</> : m.value}
                  </strong>
                  <span>{t(m.labelKey)}</span>
                </div>
              ))}
            </div>
          </div>

          <Spot className="landing-spot--hero">
            <div className="landing-console" aria-label="OKIT dashboard preview">
              <div className="landing-console-top">
                <div>
                  <span className="landing-window-dot" />
                  <span className="landing-window-dot" />
                  <span className="landing-window-dot" />
                </div>
                <span>localhost:3780</span>
              </div>
              <div className="landing-app">
                <aside className="landing-app-sidebar">
                  <span className="landing-app-brand">
                    <img src={okitIcon} alt="" className="landing-logo-img landing-logo-img--sm" />OKIT
                  </span>
                  {[
                    ['nav.home', true],
                    ['nav.ai', false],
                    ['nav.vault', false],
                    ['nav.models', false],
                    ['nav.usage', false],
                    ['nav.agents', false],
                    ['nav.settings', false],
                  ].map(([key, active]) => (
                    <span className={active ? 'active' : ''} key={key as string}>{t(key as string)}</span>
                  ))}
                </aside>
                <div className="landing-app-main">
                  <div className="landing-mock-section">
                    <span className="landing-mock-title">{t('home.agentConfig')}</span>
                    <div className="landing-agent-tabs">
                      {mockAgents.map((a) => {
                        const icon = getAgentIcon(a.id);
                        return (
                          <span className={`landing-agent-tab${a.active ? ' active' : ''}`} key={a.id}>
                            {icon && <img src={icon} alt="" />}
                            {a.name}
                          </span>
                        );
                      })}
                    </div>
                    <div className="landing-pcards">
                      {mockProviders.map((p) => {
                        const icon = getProviderIcon(p.icon);
                        return (
                          <div className="landing-pcard" key={p.name}>
                            <div className="landing-pcard-head">
                              {icon && <img src={icon} alt="" className="landing-pcard-logo" />}
                              <span className="landing-pcard-name">{p.name}</span>
                              <span className={`landing-switch${p.on ? ' on' : ''}`}><i /></span>
                            </div>
                            <div className="landing-pcard-models">
                              {p.models.map((m) => (
                                <span className={`landing-model-chip${m === p.activeModel ? ' active' : ''}`} key={m}>{m}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="landing-mock-section">
                    <span className="landing-mock-title">{t('home.usageSummary')}</span>
                    <div className="landing-usage-rows">
                      {mockUsage.map((u) => {
                        const icon = getProviderIcon(u.icon) || getAgentIcon(u.icon);
                        const tone = u.remaining <= 10 ? 'danger' : u.remaining <= 30 ? 'warn' : 'ok';
                        return (
                          <div className="landing-usage-row" key={u.name}>
                            {icon && <img src={icon} alt="" className="landing-usage-logo" />}
                            <span className="landing-usage-name">{u.name}</span>
                            <span className="landing-usage-window">{u.window}</span>
                            <span className="landing-usage-track">
                              <i className={`landing-usage-fill--${tone}`} style={{ width: `${u.remaining}%` }} />
                            </span>
                            <span className={`landing-usage-value landing-usage-value--${tone}`}>{u.remaining}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Spot>
        </section>

        <section className="landing-marquee" aria-label="Supported providers">
          <div className="landing-marquee-track">
            {Array.from({ length: 6 }, () => marqueeIds).flat().map((id, i) => {
              const src = getProviderIcon(id);
              return src ? (
                <span className="landing-logo-chip" key={`${id}-${i}`}>
                  <img src={src} alt="" loading="lazy" />
                </span>
              ) : null;
            })}
          </div>
        </section>

        {/* ---- capability sections 01–06 (07 CLI is the lime band) ---- */}
        <div id="capabilities">
          {capabilities.slice(0, 6).map((cap, index) => (
            <Reveal key={cap.id} className={`landing-cap${index % 2 === 1 ? ' landing-cap--flip' : ''}${cap.id === 'vault' ? ' landing-cap--vault' : ''}`}>
              <section>
                <div className="landing-cap-copy">
                  <span className="landing-cap-num">{cap.num}</span>
                  <h2>{t(cap.titleKey)}</h2>
                  {cap.badgeKey && <span className="landing-cap-badge">{t(cap.badgeKey)}</span>}
                  <p>{t(cap.bodyKey)}</p>
                </div>
                {cap.id === 'vault' ? (
                  <Spot className="landing-spot--vault">
                    <div className="landing-console">{capabilityVisual(cap.id)}</div>
                  </Spot>
                ) : (
                  <div className="landing-console">{capabilityVisual(cap.id)}</div>
                )}
              </section>
            </Reveal>
          ))}
        </div>

        {/* ---- 07 · CLI & Skill — lime inversion ---- */}
        <section className="landing-automation" id="cli">
          <div className="landing-automation-inner">
            <Reveal>
              <span className="landing-cap-num landing-cap-num--onlime">07</span>
              <h2>{t('landing.cap.cli.title')}</h2>
              <p>{t('landing.cap.cli.body')}</p>
            </Reveal>
            <Reveal delay={120}>
              <pre><code>{t('landing.auto.code')}</code></pre>
            </Reveal>
          </div>
        </section>

        {/* ---- comparison ---- */}
        <section className="landing-compare" id="compare">
          <Reveal>
            <div className="landing-section-head">
              <div>
                <span>{t('landing.compare.kicker')}</span>
                <h2>{t('landing.compare.title')}</h2>
              </div>
            </div>
            <div className="landing-compare-table" role="table">
              <div className="landing-compare-row landing-compare-row--head" role="row">
                <span role="columnheader">{t('landing.compare.col.cap')}</span>
                <span role="columnheader">{t('landing.compare.col.manual')}</span>
                <span role="columnheader">{t('landing.compare.col.switcher')}</span>
                <span role="columnheader">OKIT</span>
              </div>
              {compareRows.map((row) => (
                <div className="landing-compare-row" role="row" key={row.labelKey}>
                  <span role="cell">{t(row.labelKey)}</span>
                  <span role="cell" className="landing-c-no">{row.manual}</span>
                  <span role="cell" className="landing-c-mid">{row.switcher}</span>
                  <span role="cell" className="landing-c-yes">{row.okit}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ---- FAQ ---- */}
        <section className="landing-faq">
          <Reveal>
            <div className="landing-section-head">
              <div>
                <span>{t('landing.faq.kicker')}</span>
                <h2>{t('landing.faq.title')}</h2>
              </div>
            </div>
            <div className="landing-faq-list">
              {faqKeys.map((k) => (
                <details className="landing-faq-item" key={k}>
                  <summary>{t(`landing.faq.${k}.q`)}</summary>
                  <p>{t(`landing.faq.${k}.a`)}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="landing-install" id="install">
          <div>
            <span>{t('landing.install.kicker')}</span>
            <h2>{t('landing.install.title')}</h2>
          </div>
          <pre><code>npm install -g @cing-self/okit-cli{'\n'}okit web</code></pre>
        </section>
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
